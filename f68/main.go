package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"hash/fnv"
	"log"
	"math/rand"
	"net"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

type KVEntry struct {
	Value     string
	Version   int64
	Timestamp int64
}

type Node struct {
	Addr        string
	Alive       bool
	LastSeen    int64
	Incarnation int64
}

type Message struct {
	Type      string
	From      string
	To        string
	Nodes     map[string]Node
	Data      map[string]KVEntry
	Key       string
	Value     string
	Version   int64
	Timestamp int64
	Found     bool
	ReplyTo   string
}

type GossipNode struct {
	addr     string
	conn     *net.UDPConn
	mu       sync.RWMutex
	data     map[string]KVEntry
	nodes    map[string]Node
	joinAddr string
	version  int64
}

func hashKey(key string) uint32 {
	h := fnv.New32a()
	h.Write([]byte(key))
	return h.Sum32()
}

func NewGossipNode(addr string, joinAddr string) *GossipNode {
	return &GossipNode{
		addr:     addr,
		joinAddr: joinAddr,
		data:     make(map[string]KVEntry),
		nodes:    make(map[string]Node),
		version:  0,
	}
}

func (gn *GossipNode) getAliveNodesSorted() []string {
	gn.mu.RLock()
	defer gn.mu.RUnlock()

	nodes := make([]string, 0)
	for addr, node := range gn.nodes {
		if node.Alive {
			nodes = append(nodes, addr)
		}
	}
	sort.Strings(nodes)
	return nodes
}

func (gn *GossipNode) getNodeForKey(key string) (string, bool) {
	nodes := gn.getAliveNodesSorted()
	if len(nodes) == 0 {
		return "", false
	}

	hash := hashKey(key)
	idx := int(hash % uint32(len(nodes)))
	return nodes[idx], true
}

func (gn *GossipNode) isKeyLocal(key string) bool {
	node, ok := gn.getNodeForKey(key)
	if !ok {
		return true
	}
	return node == gn.addr
}

func (gn *GossipNode) Start() error {
	udpAddr, err := net.ResolveUDPAddr("udp", gn.addr)
	if err != nil {
		return err
	}

	gn.conn, err = net.ListenUDP("udp", udpAddr)
	if err != nil {
		return err
	}

	gn.mu.Lock()
	gn.nodes[gn.addr] = Node{
		Addr:        gn.addr,
		Alive:       true,
		LastSeen:    time.Now().UnixNano(),
		Incarnation: 0,
	}
	gn.mu.Unlock()

	go gn.handleIncoming()
	go gn.gossipLoop()
	go gn.failureDetector()

	if gn.joinAddr != "" {
		go gn.joinCluster()
	}

	log.Printf("节点启动，监听地址: %s", gn.addr)
	if gn.joinAddr != "" {
		log.Printf("正在加入集群: %s", gn.joinAddr)
	}

	return nil
}

func (gn *GossipNode) joinCluster() {
	maxRetries := 5
	for i := 0; i < maxRetries; i++ {
		gn.sendJoin(gn.joinAddr)
		time.Sleep(500 * time.Millisecond)

		gn.mu.RLock()
		hasOtherNodes := false
		for addr := range gn.nodes {
			if addr != gn.addr {
				hasOtherNodes = true
				break
			}
		}
		gn.mu.RUnlock()

		if hasOtherNodes {
			log.Printf("成功加入集群，发现 %d 个其他节点", len(gn.nodes)-1)
			return
		}
		log.Printf("加入集群尝试 %d/%d 失败，重试中...", i+1, maxRetries)
	}
	log.Printf("警告: 未能成功连接到集群，将作为独立节点运行")
}

func (gn *GossipNode) handleIncoming() {
	buf := make([]byte, 65536)
	for {
		n, _, err := gn.conn.ReadFromUDP(buf)
		if err != nil {
			log.Printf("读取错误: %v", err)
			continue
		}

		var msg Message
		err = json.Unmarshal(buf[:n], &msg)
		if err != nil {
			log.Printf("解析消息错误: %v", err)
			continue
		}

		gn.handleMessage(&msg)
	}
}

func (gn *GossipNode) handleMessage(msg *Message) {
	gn.mu.Lock()
	defer gn.mu.Unlock()

	if msg.From != "" {
		existing, ok := gn.nodes[msg.From]
		if !ok {
			gn.nodes[msg.From] = Node{
				Addr:        msg.From,
				Alive:       true,
				LastSeen:    time.Now().UnixNano(),
				Incarnation: 0,
			}
			log.Printf("发现新节点: %s", msg.From)
		} else {
			existing.LastSeen = time.Now().UnixNano()
			existing.Alive = true
			gn.nodes[msg.From] = existing
		}
	}

	switch msg.Type {
	case "JOIN":
		log.Printf("收到来自 %s 的加入请求", msg.From)
		gn.mu.Unlock()
		gn.sendSync(msg.From)
		gn.mu.Lock()

	case "SYNC":
		log.Printf("收到来自 %s 的同步消息 (节点数: %d, 数据数: %d)", msg.From, len(msg.Nodes), len(msg.Data))
		gn.mergeNodes(msg.Nodes)
		gn.mergeData(msg.Data)

	case "GOSSIP":
		gn.mergeNodes(msg.Nodes)
		gn.mergeData(msg.Data)

	case "PUT_FORWARD":
		log.Printf("收到转发PUT请求: %s = %s (来自 %s)", msg.Key, msg.Value, msg.From)
		gn.mu.Unlock()
		gn.putLocal(msg.Key, msg.Value, msg.Version, msg.Timestamp)
		gn.mu.Lock()

	case "GET_FORWARD":
		log.Printf("收到转发GET请求: %s (来自 %s)", msg.Key, msg.From)
		gn.mu.RUnlock()
		value, found := gn.getLocal(msg.Key)
		gn.mu.RLock()
		gn.mu.Unlock()
		gn.sendGetResponse(msg.ReplyTo, msg.Key, value, found)
		gn.mu.Lock()

	case "GET_RESP":
		if msg.Found {
			fmt.Printf("\n✓ 收到GET响应: %s = %s (来自 %s)\n> ", msg.Key, msg.Value, msg.From)
		} else {
			fmt.Printf("\n✗ 收到GET响应: %s 不存在 (来自 %s)\n> ", msg.Key, msg.From)
		}
	}
}

func (gn *GossipNode) mergeNodes(remoteNodes map[string]Node) {
	for addr, node := range remoteNodes {
		existing, ok := gn.nodes[addr]
		if !ok {
			gn.nodes[addr] = Node{
				Addr:        node.Addr,
				Alive:       node.Alive,
				LastSeen:    node.LastSeen,
				Incarnation: node.Incarnation,
			}
			if addr != gn.addr {
				log.Printf("通过Gossip发现新节点: %s", addr)
			}
		} else {
			updated := false
			if node.Incarnation > existing.Incarnation {
				existing.Incarnation = node.Incarnation
				updated = true
			}
			if node.LastSeen > existing.LastSeen {
				existing.LastSeen = node.LastSeen
				updated = true
			}
			if node.Alive && !existing.Alive {
				existing.Alive = true
				log.Printf("节点 %s 恢复在线", addr)
				updated = true
			}
			if updated {
				gn.nodes[addr] = existing
			}
		}
	}
}

func (gn *GossipNode) mergeData(remoteData map[string]KVEntry) {
	updatedCount := 0
	for key, remoteEntry := range remoteData {
		if !gn.isKeyLocal(key) {
			continue
		}
		localEntry, ok := gn.data[key]
		if !ok {
			gn.data[key] = KVEntry{
				Value:     remoteEntry.Value,
				Version:   remoteEntry.Version,
				Timestamp: remoteEntry.Timestamp,
			}
			updatedCount++
		} else {
			shouldUpdate := false
			if remoteEntry.Version > localEntry.Version {
				shouldUpdate = true
			} else if remoteEntry.Version == localEntry.Version && remoteEntry.Timestamp > localEntry.Timestamp {
				shouldUpdate = true
			}
			if shouldUpdate {
				gn.data[key] = KVEntry{
					Value:     remoteEntry.Value,
					Version:   remoteEntry.Version,
					Timestamp: remoteEntry.Timestamp,
				}
				updatedCount++
			}
		}
	}
	if updatedCount > 0 {
		log.Printf("同步更新了 %d 条数据", updatedCount)
	}
}

func (gn *GossipNode) putLocal(key, value string, version int64, timestamp int64) {
	gn.mu.Lock()
	defer gn.mu.Unlock()

	gn.version++
	if version == 0 {
		version = gn.version
	}
	if timestamp == 0 {
		timestamp = time.Now().UnixNano()
	}
	gn.data[key] = KVEntry{
		Value:     value,
		Version:   version,
		Timestamp: timestamp,
	}
	log.Printf("本地存储: %s = %s (v%d)", key, value, version)
}

func (gn *GossipNode) getLocal(key string) (string, bool) {
	gn.mu.RLock()
	defer gn.mu.RUnlock()
	entry, ok := gn.data[key]
	if !ok {
		return "", false
	}
	return entry.Value, true
}

func (gn *GossipNode) Put(key, value string) {
	targetNode, ok := gn.getNodeForKey(key)
	if !ok {
		log.Printf("没有可用节点，本地存储: %s = %s", key, value)
		gn.putLocal(key, value, 0, 0)
		return
	}

	if targetNode == gn.addr {
		log.Printf("Key %s 哈希映射到本地节点，存储数据", key)
		gn.putLocal(key, value, 0, 0)
	} else {
		log.Printf("Key %s 哈希映射到节点 %s，转发请求", key, targetNode)
		gn.mu.RLock()
		version := gn.version + 1
		gn.mu.RUnlock()
		gn.sendPutForward(targetNode, key, value, version, time.Now().UnixNano())
		fmt.Printf("PUT请求已转发到节点 %s\n", targetNode)
	}
}

func (gn *GossipNode) Get(key string) {
	targetNode, ok := gn.getNodeForKey(key)
	if !ok {
		log.Printf("没有可用节点，尝试本地读取: %s", key)
		value, found := gn.getLocal(key)
		if found {
			fmt.Printf("%s = %s\n", key, value)
		} else {
			fmt.Printf("键 %s 不存在\n", key)
		}
		return
	}

	if targetNode == gn.addr {
		log.Printf("Key %s 哈希映射到本地节点，读取数据", key)
		value, found := gn.getLocal(key)
		if found {
			fmt.Printf("%s = %s\n", key, value)
		} else {
			fmt.Printf("键 %s 不存在\n", key)
		}
	} else {
		log.Printf("Key %s 哈希映射到节点 %s，转发GET请求", key, targetNode)
		gn.sendGetForward(targetNode, key)
		fmt.Printf("GET请求已转发到节点 %s，等待响应...\n", targetNode)
	}
}

func (gn *GossipNode) sendPutForward(addr, key, value string, version, timestamp int64) {
	msg := Message{
		Type:      "PUT_FORWARD",
		From:      gn.addr,
		To:        addr,
		Key:       key,
		Value:     value,
		Version:   version,
		Timestamp: timestamp,
	}
	gn.sendTo(addr, msg)
}

func (gn *GossipNode) sendGetForward(addr, key string) {
	msg := Message{
		Type:    "GET_FORWARD",
		From:    gn.addr,
		To:      addr,
		Key:     key,
		ReplyTo: gn.addr,
	}
	gn.sendTo(addr, msg)
}

func (gn *GossipNode) sendGetResponse(addr, key, value string, found bool) {
	msg := Message{
		Type:  "GET_RESP",
		From:  gn.addr,
		To:    addr,
		Key:   key,
		Value: value,
		Found: found,
	}
	gn.sendTo(addr, msg)
}

func (gn *GossipNode) sendJoin(addr string) {
	msg := Message{
		Type: "JOIN",
		From: gn.addr,
	}
	gn.sendTo(addr, msg)
}

func (gn *GossipNode) sendSync(addr string) {
	gn.mu.RLock()
	msg := Message{
		Type:  "SYNC",
		From:  gn.addr,
		Nodes: make(map[string]Node),
		Data:  make(map[string]KVEntry),
	}
	for k, v := range gn.nodes {
		msg.Nodes[k] = v
	}
	for k, v := range gn.data {
		msg.Data[k] = v
	}
	gn.mu.RUnlock()
	gn.sendTo(addr, msg)
}

func (gn *GossipNode) sendTo(addr string, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("序列化消息错误: %v", err)
		return
	}

	udpAddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		log.Printf("解析地址错误: %v", err)
		return
	}

	_, err = gn.conn.WriteToUDP(data, udpAddr)
	if err != nil {
		log.Printf("发送消息到 %s 错误: %v", addr, err)
	}
}

func (gn *GossipNode) gossipLoop() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		gn.gossip()
	}
}

func (gn *GossipNode) triggerGossip() {
	gn.gossip()
	time.Sleep(200 * time.Millisecond)
	gn.gossip()
}

func (gn *GossipNode) gossip() {
	gn.mu.RLock()
	aliveNodes := make([]string, 0)
	for addr, node := range gn.nodes {
		if addr != gn.addr && node.Alive {
			aliveNodes = append(aliveNodes, addr)
		}
	}

	if len(aliveNodes) == 0 {
		gn.mu.RUnlock()
		return
	}

	msg := Message{
		Type:  "GOSSIP",
		From:  gn.addr,
		Nodes: make(map[string]Node),
		Data:  make(map[string]KVEntry),
	}
	for k, v := range gn.nodes {
		msg.Nodes[k] = v
	}
	for k, v := range gn.data {
		msg.Data[k] = v
	}
	gn.mu.RUnlock()

	var targets []string
	if len(aliveNodes) <= 5 {
		targets = aliveNodes
	} else {
		fanout := 3
		if len(aliveNodes) < fanout {
			fanout = len(aliveNodes)
		}
		selected := make(map[string]bool)
		for len(selected) < fanout {
			idx := rand.Intn(len(aliveNodes))
			selected[aliveNodes[idx]] = true
		}
		targets = make([]string, 0, len(selected))
		for addr := range selected {
			targets = append(targets, addr)
		}
	}

	for _, addr := range targets {
		gn.sendTo(addr, msg)
	}
}

func (gn *GossipNode) failureDetector() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		gn.checkFailure()
	}
}

func (gn *GossipNode) checkFailure() {
	gn.mu.Lock()
	defer gn.mu.Unlock()

	now := time.Now().UnixNano()
	timeout := int64(3 * time.Second)

	for addr, node := range gn.nodes {
		if addr == gn.addr {
			continue
		}
		if now-node.LastSeen > timeout {
			if node.Alive {
				node.Alive = false
				gn.nodes[addr] = node
				log.Printf("节点 %s 被标记为失效 (超时)", addr)
			}
		}
	}
}

func (gn *GossipNode) PrintStatus() {
	gn.mu.RLock()
	defer gn.mu.RUnlock()

	fmt.Println("\n=== 节点状态 ===")
	fmt.Printf("本地地址: %s\n", gn.addr)
	fmt.Printf("数据版本: %d\n", gn.version)
	fmt.Println("\n集群成员:")
	aliveCount := 0
	aliveNodes := make([]string, 0)
	for addr, node := range gn.nodes {
		status := "存活"
		if !node.Alive {
			status = "失效"
		} else {
			aliveCount++
			aliveNodes = append(aliveNodes, addr)
		}
		prefix := "  "
		if addr == gn.addr {
			prefix = "* "
		}
		fmt.Printf("%s%s - %s\n", prefix, addr, status)
	}
	fmt.Printf("\n存活节点数: %d/%d\n", aliveCount, len(gn.nodes))

	sort.Strings(aliveNodes)
	if len(aliveNodes) > 0 {
		fmt.Println("\n分片映射:")
		for i, node := range aliveNodes {
			prefix := "  "
			if node == gn.addr {
				prefix = "* "
			}
			fmt.Printf("%s节点 %d: %s (处理 hash%%%d == %d 的key)\n", prefix, i, node, len(aliveNodes), i)
		}
	}

	fmt.Println("\n本地存储数据:")
	if len(gn.data) == 0 {
		fmt.Println("  (空)")
	} else {
		for k, v := range gn.data {
			hash := hashKey(k)
			idx := int(hash % uint32(len(aliveNodes)))
			fmt.Printf("  %s = %s (v%d, hash=%d, 分片=%d)\n", k, v.Value, v.Version, hash, idx)
		}
	}
	fmt.Println("===============\n")
}

func main() {
	port := flag.Int("port", 8000, "本地监听端口")
	join := flag.String("join", "", "要加入的节点地址 (host:port)")
	flag.Parse()

	addr := fmt.Sprintf("127.0.0.1:%d", *port)

	var joinAddr string
	if *join != "" {
		if !strings.Contains(*join, ":") {
			joinAddr = fmt.Sprintf("127.0.0.1:%s", *join)
		} else {
			joinAddr = *join
		}
	}

	node := NewGossipNode(addr, joinAddr)
	err := node.Start()
	if err != nil {
		log.Fatalf("启动节点失败: %v", err)
	}

	reader := bufio.NewReader(os.Stdin)
	fmt.Println("========================================")
	fmt.Println("  基于Gossip协议的分布式键值存储")
	fmt.Println("          (支持数据分片)")
	fmt.Println("========================================")
	fmt.Println("可用命令:")
	fmt.Println("  PUT <key> <value> - 存储键值对（自动路由）")
	fmt.Println("  GET <key>         - 获取键值（自动路由）")
	fmt.Println("  STATUS            - 显示节点状态和分片信息")
	fmt.Println("  HELP              - 显示帮助")
	fmt.Println("  EXIT              - 退出程序")
	fmt.Println("----------------------------------------")

	for {
		fmt.Print("> ")
		input, err := reader.ReadString('\n')
		if err != nil {
			log.Printf("读取输入错误: %v", err)
			continue
		}
		input = strings.TrimSpace(input)
		if input == "" {
			continue
		}

		parts := strings.Fields(input)
		cmd := strings.ToUpper(parts[0])

		switch cmd {
		case "PUT":
			if len(parts) < 3 {
				fmt.Println("用法: PUT <key> <value>")
				continue
			}
			key := parts[1]
			value := strings.Join(parts[2:], " ")
			node.Put(key, value)

		case "GET":
			if len(parts) != 2 {
				fmt.Println("用法: GET <key>")
				continue
			}
			key := parts[1]
			node.Get(key)

		case "STATUS":
			node.PrintStatus()

		case "HELP":
			fmt.Println("可用命令:")
			fmt.Println("  PUT <key> <value> - 存储键值对（自动路由）")
			fmt.Println("  GET <key>         - 获取键值（自动路由）")
			fmt.Println("  STATUS            - 显示节点状态和分片信息")
			fmt.Println("  HELP              - 显示帮助")
			fmt.Println("  EXIT              - 退出程序")

		case "EXIT", "QUIT":
			fmt.Println("退出程序...")
			return

		default:
			fmt.Printf("未知命令: %s，输入 HELP 查看可用命令\n", cmd)
		}
	}
}
