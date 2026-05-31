package websocket

import (
	"encoding/json"
	"sync"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"net/http"
)

type Client struct {
	ID     string
	Conn   *websocket.Conn
	Send   chan []byte
	TaskID uint
}

type Manager struct {
	Clients    map[*Client]bool
	Broadcast  chan []byte
	Register   chan *Client
	Unregister chan *Client
	mu         sync.RWMutex
}

var TaskManager = &Manager{
	Clients:    make(map[*Client]bool),
	Broadcast:  make(chan []byte),
	Register:   make(chan *Client),
	Unregister: make(chan *Client),
}

func (m *Manager) Start() {
	for {
		select {
		case client := <-m.Register:
			m.mu.Lock()
			m.Clients[client] = true
			m.mu.Unlock()
		case client := <-m.Unregister:
			m.mu.Lock()
			if _, ok := m.Clients[client]; ok {
				delete(m.Clients, client)
				close(client.Send)
			}
			m.mu.Unlock()
		case message := <-m.Broadcast:
			m.mu.RLock()
			for client := range m.Clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(m.Clients, client)
				}
			}
			m.mu.RUnlock()
		}
	}
}

func (m *Manager) BroadcastToTask(taskID uint, message interface{}) {
	data, err := json.Marshal(message)
	if err != nil {
		return
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	for client := range m.Clients {
		if client.TaskID == taskID {
			select {
			case client.Send <- data:
			default:
				close(client.Send)
				delete(m.Clients, client)
			}
		}
	}
}

type LogMessage struct {
	Type      string `json:"type"`
	TaskID    uint   `json:"task_id"`
	LogID     uint   `json:"log_id"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
	Status    string `json:"status"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func ServeWs(c *gin.Context, taskID uint) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	client := &Client{
		Conn:   conn,
		Send:   make(chan []byte, 256),
		TaskID: taskID,
	}
	TaskManager.Register <- client
	go client.writePump()
	go client.readPump()
}

func (c *Client) writePump() {
	defer func() {
		c.Conn.Close()
		TaskManager.Unregister <- c
	}()
	for {
		select {
		case message, ok := <-c.Send:
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.Conn.WriteMessage(websocket.TextMessage, message)
		}
	}
}

func (c *Client) readPump() {
	defer func() {
		TaskManager.Unregister <- c
		c.Conn.Close()
	}()
	for {
		_, _, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func BroadcastLog(taskID uint, logID uint, message string, status string) {
	logMsg := LogMessage{
		Type:      "log",
		TaskID:    taskID,
		LogID:     logID,
		Message:   message,
		Timestamp: "",
		Status:    status,
	}
	TaskManager.BroadcastToTask(taskID, logMsg)
}
