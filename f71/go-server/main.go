package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type ConfigMessage struct {
	Type                string `json:"type"`
	FFTSize             int    `json:"fftSize"`
	SampleRate          int    `json:"sampleRate"`
	BroadcastRateLimit  int    `json:"broadcastRateLimit"`
	EstimatedPacketSize int    `json:"estimatedPacketSize"`
}

type FFTData struct {
	Type        string    `json:"type"`
	Magnitudes  []float64 `json:"magnitudes"`
	Frequencies []float64 `json:"frequencies"`
	SampleRate  float64   `json:"sampleRate"`
	FFTSize     int       `json:"fftSize"`
	Timestamp   int64     `json:"timestamp"`
	ClientID    string    `json:"clientId,omitempty"`
}

type Client struct {
	conn                *websocket.Conn
	send                chan []byte
	hub                 *Hub
	isPub               bool
	lastBroadcastTime   atomic.Int64
	broadcastRateLimit  atomic.Int32
	estimatedPacketSize atomic.Int32
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

func newHub() *Hub {
	return &Hub{
		broadcast:  make(chan []byte, 1024),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
	}
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("Client connected (pub=%v). Total: %d", client.isPub, len(h.clients))

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			log.Printf("Client disconnected. Total: %d", len(h.clients))

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				if !client.isPub {
					select {
					case client.send <- message:
					default:
						h.mu.RUnlock()
						h.mu.Lock()
						if _, ok := h.clients[client]; ok {
							close(client.send)
							delete(h.clients, client)
						}
						h.mu.Unlock()
						h.mu.RLock()
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Error: %v", err)
			}
			break
		}

		var typeCheck struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(message, &typeCheck); err != nil {
			log.Printf("Invalid message: %v", err)
			continue
		}

		if typeCheck.Type == "config" {
			var config ConfigMessage
			if err := json.Unmarshal(message, &config); err == nil {
				c.broadcastRateLimit.Store(int32(config.BroadcastRateLimit))
				c.estimatedPacketSize.Store(int32(config.EstimatedPacketSize))
				log.Printf("Config updated: FFTSize=%d, RateLimit=%d fps, PacketSize=%d bytes",
					config.FFTSize, config.BroadcastRateLimit, config.EstimatedPacketSize)
			}
			continue
		}

		rateLimit := int(c.broadcastRateLimit.Load())
		if rateLimit > 0 {
			minInterval := int64(1000 / rateLimit)
			now := time.Now().UnixMilli()
			last := c.lastBroadcastTime.Load()
			if now-last < minInterval {
				continue
			}
			c.lastBroadcastTime.Store(now)
		}

		var fftData FFTData
		if err := json.Unmarshal(message, &fftData); err != nil {
			log.Printf("Invalid FFT data: %v", err)
			continue
		}

		select {
		case c.hub.broadcast <- message:
		default:
			log.Println("Broadcast channel full, dropping message")
		}
	}
}

func (c *Client) writePump() {
	defer func() {
		c.conn.Close()
	}()

	for message := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			log.Printf("Write error: %v", err)
			return
		}
	}
}

func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	isPub := r.URL.Query().Get("pub") == "true"
	client := &Client{
		hub:   hub,
		conn:  conn,
		send:  make(chan []byte, 256),
		isPub: isPub,
	}
	client.broadcastRateLimit.Store(60)

	client.hub.register <- client

	go client.writePump()
	client.readPump()
}

func main() {
	hub := newHub()
	go hub.run()

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(hub, w, r)
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		hub.mu.RLock()
		clientCount := len(hub.clients)
		hub.mu.RUnlock()

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "ok",
			"clients": clientCount,
		})
	})

	log.Println("WebSocket server starting on :8080")
	log.Println("Publisher endpoint: ws://localhost:8080/ws?pub=true")
	log.Println("Subscriber endpoint: ws://localhost:8080/ws")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
