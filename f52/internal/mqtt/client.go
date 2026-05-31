package mqtt

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"strings"
	"time"

	mqttlib "github.com/eclipse/paho.mqtt.golang"
	"github.com/go-redis/redis/v8"
	"iot-device-shadow/internal/database"
	"iot-device-shadow/pkg/utils"
)

const (
	deltaPushCooldown    = 30 * time.Second
	maxDeltaPushAttempts = 5
)

type Client struct {
	client    mqttlib.Client
	redis     *redis.Client
	db        *database.Store
	config    *utils.Config
	ctx       context.Context
}

type DeviceShadow struct {
	DeviceID  string                 `json:"device_id"`
	State     State                  `json:"state"`
	Version   int64                  `json:"version"`
	Timestamp int64                  `json:"timestamp"`
}

type State struct {
	Desired  map[string]interface{} `json:"desired"`
	Reported map[string]interface{} `json:"reported"`
}

func NewClient(config *utils.Config, redisClient *redis.Client, dbStore *database.Store) *Client {
	return &Client{
		config: config,
		redis:  redisClient,
		db:     dbStore,
		ctx:    context.Background(),
	}
}

func (m *Client) Connect() error {
	opts := mqttlib.NewClientOptions()
	opts.AddBroker(m.config.MQTTBroker)
	opts.SetClientID(m.config.MQTTClientID)
	opts.SetAutoReconnect(true)
	opts.SetConnectionLostHandler(func(c mqttlib.Client, err error) {
		log.Printf("MQTT connection lost: %v", err)
	})
	opts.SetOnConnectHandler(func(c mqttlib.Client) {
		log.Println("MQTT connected")
		if err := m.SubscribeReport(); err != nil {
			log.Printf("Failed to subscribe: %v", err)
		}
	})

	m.client = mqttlib.NewClient(opts)
	if token := m.client.Connect(); token.Wait() && token.Error() != nil {
		return fmt.Errorf("mqtt connect error: %w", token.Error())
	}

	return nil
}

func (m *Client) SubscribeReport() error {
	topic := "device/+/report"
	token := m.client.Subscribe(topic, 1, m.handleReport)
	if token.Wait() && token.Error() != nil {
		return fmt.Errorf("subscribe error: %w", token.Error())
	}
	log.Printf("Subscribed to %s", topic)
	return nil
}

func (m *Client) handleReport(client mqttlib.Client, msg mqttlib.Message) {
	topic := msg.Topic()
	parts := strings.Split(topic, "/")
	if len(parts) < 2 {
		log.Printf("Invalid topic: %s", topic)
		return
	}
	deviceID := parts[1]

	var reported map[string]interface{}
	if err := utils.FromJSON(string(msg.Payload()), &reported); err != nil {
		log.Printf("Parse payload error for device %s: %v", deviceID, err)
		return
	}

	if err := m.saveReportedState(deviceID, reported); err != nil {
		log.Printf("Save reported state error: %v", err)
		return
	}

	if err := m.checkAndPushDelta(deviceID); err != nil {
		log.Printf("Check delta error: %v", err)
	}
}

func (m *Client) saveReportedState(deviceID string, reported map[string]interface{}) error {
	key := fmt.Sprintf("device:%s:shadow", deviceID)

	existing, _ := m.GetShadow(deviceID)

	version, err := m.redis.HIncrBy(m.ctx, key, "version", 1).Result()
	if err != nil {
		return err
	}

	reportedJSON := utils.ToJSON(reported)
	desiredJSON := utils.ToJSON(existing.State.Desired)

	pipe := m.redis.TxPipeline()
	pipe.HSet(m.ctx, key, "reported", reportedJSON)
	pipe.HSet(m.ctx, key, "timestamp", time.Now().Unix())
	_, err = pipe.Exec(m.ctx)
	if err != nil {
		return err
	}

	if m.db != nil {
		go m.writeLog(&database.DeviceShadowLog{
			DeviceID:   deviceID,
			Version:    version,
			ChangeType: string(database.ChangeTypeReported),
			Desired:    desiredJSON,
			Reported:   reportedJSON,
		})
	}

	log.Printf("Device %s reported state saved, version: %d", deviceID, version)
	return nil
}

func (m *Client) checkAndPushDelta(deviceID string) error {
	shadow, err := m.GetShadow(deviceID)
	if err != nil {
		return err
	}

	delta := utils.CalculateDelta(shadow.State.Desired, shadow.State.Reported)
	if utils.IsEmptyDelta(delta) {
		m.clearDeltaMeta(deviceID)
		return nil
	}

	deltaPayload := utils.ToJSON(delta)
	deltaHash := m.hashDelta(deltaPayload)

	metaKey := fmt.Sprintf("device:%s:delta_meta", deviceID)
	now := time.Now().Unix()

	lastHash, _ := m.redis.HGet(m.ctx, metaKey, "last_hash").Result()
	lastPushTime, _ := m.redis.HGet(m.ctx, metaKey, "last_push_time").Int64()
	attemptCount, _ := m.redis.HGet(m.ctx, metaKey, "attempt_count").Int64()

	if lastHash == deltaHash {
		if now-lastPushTime < int64(deltaPushCooldown.Seconds()) {
			log.Printf("Delta for device %s is unchanged and within cooldown, skipping", deviceID)
			return nil
		}
		if attemptCount >= maxDeltaPushAttempts {
			log.Printf("Delta for device %s reached max attempts (%d), stopping push", deviceID, maxDeltaPushAttempts)
			return nil
		}
	} else {
		attemptCount = 0
	}

	deltaMsg := utils.Delta{
		DeviceID: deviceID,
		Delta:    delta,
		Version:  shadow.Version,
	}

	topic := fmt.Sprintf("device/%s/delta", deviceID)
	payload := utils.ToJSON(deltaMsg)

	token := m.client.Publish(topic, 1, false, payload)
	if token.Wait() && token.Error() != nil {
		return fmt.Errorf("publish delta error: %w", token.Error())
	}

	attemptCount++
	pipe := m.redis.TxPipeline()
	pipe.HSet(m.ctx, metaKey, "last_hash", deltaHash)
	pipe.HSet(m.ctx, metaKey, "last_push_time", now)
	pipe.HSet(m.ctx, metaKey, "attempt_count", attemptCount)
	pipe.Expire(m.ctx, metaKey, 24*time.Hour)
	_, _ = pipe.Exec(m.ctx)

	log.Printf("Delta pushed to %s (attempt %d/%d): %s", topic, attemptCount, maxDeltaPushAttempts, payload)
	return nil
}

func (m *Client) hashDelta(data string) string {
	h := sha256.New()
	h.Write([]byte(data))
	return hex.EncodeToString(h.Sum(nil))
}

func (m *Client) clearDeltaMeta(deviceID string) {
	metaKey := fmt.Sprintf("device:%s:delta_meta", deviceID)
	_ = m.redis.Del(m.ctx, metaKey).Err()
}

func (m *Client) GetShadow(deviceID string) (*DeviceShadow, error) {
	key := fmt.Sprintf("device:%s:shadow", deviceID)

	data, err := m.redis.HGetAll(m.ctx, key).Result()
	if err != nil {
		return nil, err
	}

	shadow := &DeviceShadow{
		DeviceID: deviceID,
		State: State{
			Desired:  make(map[string]interface{}),
			Reported: make(map[string]interface{}),
		},
		Version:   0,
		Timestamp: 0,
	}

	if desiredStr, ok := data["desired"]; ok && desiredStr != "" {
		_ = utils.FromJSON(desiredStr, &shadow.State.Desired)
	}

	if reportedStr, ok := data["reported"]; ok && reportedStr != "" {
		_ = utils.FromJSON(reportedStr, &shadow.State.Reported)
	}

	if versionStr, ok := data["version"]; ok {
		fmt.Sscanf(versionStr, "%d", &shadow.Version)
	}

	if tsStr, ok := data["timestamp"]; ok {
		fmt.Sscanf(tsStr, "%d", &shadow.Timestamp)
	}

	return shadow, nil
}

func (m *Client) UpdateDesiredState(deviceID string, desired map[string]interface{}) (*DeviceShadow, error) {
	key := fmt.Sprintf("device:%s:shadow", deviceID)

	existing, _ := m.GetShadow(deviceID)
	merged := utils.MergeMaps(existing.State.Desired, desired)

	version, err := m.redis.HIncrBy(m.ctx, key, "version", 1).Result()
	if err != nil {
		return nil, err
	}

	desiredJSON := utils.ToJSON(merged)
	reportedJSON := utils.ToJSON(existing.State.Reported)

	pipe := m.redis.TxPipeline()
	pipe.HSet(m.ctx, key, "desired", desiredJSON)
	pipe.HSet(m.ctx, key, "timestamp", time.Now().Unix())
	_, err = pipe.Exec(m.ctx)
	if err != nil {
		return nil, err
	}

	if m.db != nil {
		go m.writeLog(&database.DeviceShadowLog{
			DeviceID:   deviceID,
			Version:    version,
			ChangeType: string(database.ChangeTypeDesired),
			Desired:    desiredJSON,
			Reported:   reportedJSON,
		})
	}

	if err := m.checkAndPushDelta(deviceID); err != nil {
		log.Printf("Push delta error: %v", err)
	}

	return m.GetShadow(deviceID)
}

func (m *Client) writeLog(logEntry *database.DeviceShadowLog) {
	if m.db == nil {
		return
	}
	if err := m.db.InsertLog(m.ctx, logEntry); err != nil {
		log.Printf("Failed to write shadow log for device %s: %v", logEntry.DeviceID, err)
	}
}

func (m *Client) Disconnect() {
	if m.client != nil && m.client.IsConnected() {
		m.client.Disconnect(250)
	}
}
