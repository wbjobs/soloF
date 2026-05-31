package mqtt

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	mqtt "github.com/mochi-mqtt/server/v2"
	"github.com/mochi-mqtt/server/v2/packets"
)

const (
	TopicHeartbeat    = "device/+/heartbeat"
	TopicVersionReport = "device/+/version"
	TopicUpgradeCmd   = "device/%s/upgrade/cmd"
	TopicUpgradeData  = "device/%s/upgrade/data"
	TopicUpgradeAck   = "device/+/upgrade/ack"
	ChunkSize         = 1024 * 8
	FirmwareStorage   = "../firmware_storage"
)

var AESKey = []byte("ota-1234567890-key")

type DeviceInfo struct {
	DeviceID    string    `json:"device_id"`
	IP          string    `json:"ip"`
	Version     string    `json:"version"`
	LastSeen    time.Time `json:"last_seen"`
	Status      string    `json:"status"`
	UpgradeInfo *UpgradeProgress `json:"upgrade_info,omitempty"`
}

type UpgradeProgress struct {
	FirmwareID string `json:"firmware_id"`
	Version    string `json:"version"`
	TotalSize  int64  `json:"total_size"`
	Received   int64  `json:"received"`
	Checksum   string `json:"checksum"`
}

type FirmwareInfo struct {
	ID       string `json:"id"`
	Version  string `json:"version"`
	Size     int64  `json:"size"`
	Checksum string `json:"checksum"`
	Path     string `json:"-"`
}

type GrayReleaseConfig struct {
	Enabled       bool     `json:"enabled"`
	AllowedPrefixes []string `json:"allowed_prefixes"`
}

type Broker struct {
	server          *mqtt.Server
	devices         map[string]*DeviceInfo
	firmwares       map[string]*FirmwareInfo
	deviceLock      sync.RWMutex
	fwLock          sync.RWMutex
	grayConfig      GrayReleaseConfig
	grayConfigLock  sync.RWMutex
}

func NewBroker() *Broker {
	return &Broker{
		devices:   make(map[string]*DeviceInfo),
		firmwares: make(map[string]*FirmwareInfo),
		grayConfig: GrayReleaseConfig{
			Enabled:       false,
			AllowedPrefixes: []string{},
		},
	}
}

func (b *Broker) Start() error {
	b.server = mqtt.New(&mqtt.Options{
		InlineClient: true,
	})

	err := b.server.AddHook(new(AuthHook), nil)
	if err != nil {
		return err
	}

	b.setupSubscriptions()

	go b.loadFirmwares()

	log.Println("MQTT Broker starting on :1883")
	return b.server.ServeTCP(":1883")
}

func (b *Broker) setupSubscriptions() {
	b.server.OnSubscribe = func(cl *mqtt.Client, sub packets.Subscription) packets.Subscription {
		log.Printf("Client subscribed to: %s", sub.Filter)
		return sub
	}

	b.server.OnMessage = func(cl *mqtt.Client, sub packets.Subscription, pk packets.Packet) {
		b.handleMessage(pk.TopicName, pk.Payload)
	}

	b.server.Subscribe("device/#", 0, b.handleMessage)
}

func (b *Broker) handleMessage(topic string, payload []byte) {
	log.Printf("Received message on %s: %s", topic, string(payload))

	switch {
	case matchTopic(TopicHeartbeat, topic):
		b.handleHeartbeat(topic, payload)
	case matchTopic(TopicVersionReport, topic):
		b.handleVersionReport(topic, payload)
	case matchTopic(TopicUpgradeAck, topic):
		b.handleUpgradeAck(topic, payload)
	}
}

func (b *Broker) handleHeartbeat(topic string, payload []byte) {
	deviceID := extractDeviceID(topic)
	var data struct {
		IP string `json:"ip"`
	}
	json.Unmarshal(payload, &data)

	b.deviceLock.Lock()
	defer b.deviceLock.Unlock()

	if _, exists := b.devices[deviceID]; !exists {
		b.devices[deviceID] = &DeviceInfo{
			DeviceID: deviceID,
			Status:   "online",
		}
	}
	b.devices[deviceID].IP = data.IP
	b.devices[deviceID].LastSeen = time.Now()
}

func (b *Broker) handleVersionReport(topic string, payload []byte) {
	deviceID := extractDeviceID(topic)
	var data struct {
		Version string `json:"version"`
	}
	json.Unmarshal(payload, &data)

	b.deviceLock.Lock()
	defer b.deviceLock.Unlock()

	if _, exists := b.devices[deviceID]; !exists {
		b.devices[deviceID] = &DeviceInfo{
			DeviceID: deviceID,
			Status:   "online",
		}
	}
	b.devices[deviceID].Version = data.Version
	b.devices[deviceID].LastSeen = time.Now()
}

func (b *Broker) handleUpgradeAck(topic string, payload []byte) {
	deviceID := extractDeviceID(topic)
	var data struct {
		FirmwareID string `json:"firmware_id"`
		Received   int64  `json:"received"`
		Complete   bool   `json:"complete"`
	}
	json.Unmarshal(payload, &data)

	b.deviceLock.Lock()
	defer b.deviceLock.Unlock()

	if device, exists := b.devices[deviceID]; exists && device.UpgradeInfo != nil {
		device.UpgradeInfo.Received = data.Received
		if data.Complete {
			device.Status = "idle"
			device.UpgradeInfo = nil
		} else {
			go b.sendUpgradeData(deviceID, data.Received)
		}
	}
}

func (b *Broker) SetGrayReleaseConfig(config GrayReleaseConfig) {
	b.grayConfigLock.Lock()
	defer b.grayConfigLock.Unlock()
	b.grayConfig = config
}

func (b *Broker) GetGrayReleaseConfig() GrayReleaseConfig {
	b.grayConfigLock.RLock()
	defer b.grayConfigLock.RUnlock()
	return b.grayConfig
}

func (b *Broker) isDeviceAllowed(deviceID string) bool {
	b.grayConfigLock.RLock()
	defer b.grayConfigLock.RUnlock()

	if !b.grayConfig.Enabled {
		return true
	}

	for _, prefix := range b.grayConfig.AllowedPrefixes {
		if len(deviceID) >= len(prefix) && deviceID[:len(prefix)] == prefix {
			return true
		}
	}
	return false
}

func (b *Broker) StartUpgrade(deviceID, firmwareID string) error {
	b.deviceLock.RLock()
	device, exists := b.devices[deviceID]
	b.deviceLock.RUnlock()

	if !exists {
		return fmt.Errorf("device not found")
	}

	if !b.isDeviceAllowed(deviceID) {
		return fmt.Errorf("device not in gray release list")
	}

	b.fwLock.RLock()
	firmware, exists := b.firmwares[firmwareID]
	b.fwLock.RUnlock()

	if !exists {
		return fmt.Errorf("firmware not found")
	}

	device.Status = "upgrading"
	device.UpgradeInfo = &UpgradeProgress{
		FirmwareID: firmwareID,
		Version:    firmware.Version,
		TotalSize:  firmware.Size,
		Received:   0,
		Checksum:   firmware.Checksum,
	}

	cmd := map[string]interface{}{
		"firmware_id": firmwareID,
		"version":     firmware.Version,
		"total_size":  firmware.Size,
		"checksum":    firmware.Checksum,
		"aes_key":     hex.EncodeToString(AESKey),
	}

	cmdPayload, _ := json.Marshal(cmd)
	topic := fmt.Sprintf(TopicUpgradeCmd, deviceID)
	b.server.Publish(topic, cmdPayload, false, 1)

	go b.sendUpgradeData(deviceID, 0)

	return nil
}

func (b *Broker) sendUpgradeData(deviceID string, offset int64) {
	b.deviceLock.RLock()
	device := b.devices[deviceID]
	b.deviceLock.RUnlock()

	if device == nil || device.UpgradeInfo == nil {
		return
	}

	b.fwLock.RLock()
	firmware := b.firmwares[device.UpgradeInfo.FirmwareID]
	b.fwLock.RUnlock()

	if firmware == nil {
		return
	}

	file, err := os.Open(firmware.Path)
	if err != nil {
		log.Printf("Failed to open firmware: %v", err)
		return
	}
	defer file.Close()

	_, err = file.Seek(offset, 0)
	if err != nil {
		log.Printf("Seek error: %v", err)
		return
	}

	chunk := make([]byte, ChunkSize)
	n, err := file.Read(chunk)
	if err != nil {
		log.Printf("Read error: %v", err)
		return
	}

	encryptedChunk, err := encryptAES(chunk[:n], AESKey)
	if err != nil {
		log.Printf("Encrypt error: %v", err)
		return
	}

	data := map[string]interface{}{
		"firmware_id": firmware.ID,
		"offset":      offset,
		"size":        n,
		"data":        hex.EncodeToString(encryptedChunk),
	}

	payload, _ := json.Marshal(data)
	topic := fmt.Sprintf(TopicUpgradeData, deviceID)
	b.server.Publish(topic, payload, false, 1)
}

func encryptAES(data, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	padded := pkcs7Pad(data, block.BlockSize())
	ciphertext := make([]byte, block.BlockSize()+len(padded))
	iv := ciphertext[:block.BlockSize()]

	mode := cipher.NewCBCEncrypter(block, iv)
	mode.CryptBlocks(ciphertext[block.BlockSize():], padded)

	return ciphertext, nil
}

func pkcs7Pad(data []byte, blockSize int) []byte {
	padding := blockSize - len(data)%blockSize
	padtext := make([]byte, padding)
	for i := range padtext {
		padtext[i] = byte(padding)
	}
	return append(data, padtext...)
}

func (b *Broker) loadFirmwares() {
	os.MkdirAll(FirmwareStorage, 0755)
	files, _ := filepath.Glob(filepath.Join(FirmwareStorage, "*.bin"))

	b.fwLock.Lock()
	defer b.fwLock.Unlock()

	for _, file := range files {
		info, _ := os.Stat(file)
		checksum := calculateChecksum(file)
		id := filepath.Base(file[:len(file)-4])

		b.firmwares[id] = &FirmwareInfo{
			ID:       id,
			Version:  id,
			Size:     info.Size(),
			Checksum: checksum,
			Path:     file,
		}
	}
}

func calculateChecksum(path string) string {
	data, _ := os.ReadFile(path)
	hash := md5.Sum(data)
	return hex.EncodeToString(hash[:])
}

func (b *Broker) GetDevices() map[string]*DeviceInfo {
	b.deviceLock.RLock()
	defer b.deviceLock.RUnlock()
	return b.devices
}

func (b *Broker) GetFirmwares() map[string]*FirmwareInfo {
	b.fwLock.RLock()
	defer b.fwLock.RUnlock()
	return b.firmwares
}

func (b *Broker) AddFirmware(id string, data []byte) error {
	path := filepath.Join(FirmwareStorage, id+".bin")
	err := os.WriteFile(path, data, 0644)
	if err != nil {
		return err
	}

	info, _ := os.Stat(path)
	checksum := calculateChecksum(path)

	b.fwLock.Lock()
	defer b.fwLock.Unlock()
	b.firmwares[id] = &FirmwareInfo{
		ID:       id,
		Version:  id,
		Size:     info.Size(),
		Checksum: checksum,
		Path:     path,
	}
	return nil
}

func matchTopic(pattern, topic string) bool {
	return len(topic) > 7 && topic[:7] == pattern[:7]
}

func extractDeviceID(topic string) string {
	parts := splitTopic(topic)
	if len(parts) >= 2 {
		return parts[1]
	}
	return ""
}

func splitTopic(topic string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(topic); i++ {
		if topic[i] == '/' {
			parts = append(parts, topic[start:i])
			start = i + 1
		}
	}
	parts = append(parts, topic[start:])
	return parts
}

type AuthHook struct {
	mqtt.HookBase
}

func (h *AuthHook) Provides(b byte) bool {
	return bytesContains([]byte{
		mqtt.OnConnectAuthenticate,
		mqtt.OnACLCheck,
	}, b)
}

func (h *AuthHook) OnConnectAuthenticate(cl *mqtt.Client, pk packets.Packet) bool {
	return true
}

func (h *AuthHook) OnACLCheck(cl *mqtt.Client, topic string, write bool) bool {
	return true
}

func bytesContains(haystack []byte, needle byte) bool {
	for _, b := range haystack {
		if b == needle {
			return true
		}
	}
	return false
}
