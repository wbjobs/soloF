package influxdb

import (
	"context"
	"time"

	"anomaly-detection-service/config"

	influxdb2 "influxdata.com/influxdb-client-go/v2"
	"influxdata.com/influxdb-client-go/v2/api"
)

type SensorData struct {
	DeviceID  string
	Timestamp time.Time
	Temp      float64
	Vibration float64
	Current   float64
}

type AnomalyRecord struct {
	DeviceID    string    `json:"deviceId"`
	Timestamp   time.Time `json:"timestamp"`
	Metric      string    `json:"metric"`
	Value       float64   `json:"value"`
	Method      string    `json:"method"`
	Confidence  float64   `json:"confidence"`
	Description string    `json:"description"`
}

type Client struct {
	client   influxdb2.Client
	writeAPI api.WriteAPIBlocking
	queryAPI api.QueryAPI
	bucket   string
	org      string
}

func NewClient(cfg *config.InfluxDBConfig) *Client {
	client := influxdb2.NewClient(cfg.URL, cfg.Token)
	return &Client{
		client:   client,
		writeAPI: client.WriteAPIBlocking(cfg.Org, cfg.Bucket),
		queryAPI: client.QueryAPI(cfg.Org),
		bucket:   cfg.Bucket,
		org:      cfg.Org,
	}
}

func (c *Client) WriteSensorData(ctx context.Context, data SensorData) error {
	p := influxdb2.NewPointWithMeasurement("sensor_data").
		AddTag("device_id", data.DeviceID).
		AddField("temperature", data.Temp).
		AddField("vibration", data.Vibration).
		AddField("current", data.Current).
		SetTime(data.Timestamp)

	return c.writeAPI.WritePoint(ctx, p)
}

func (c *Client) WriteSensorDataBatch(ctx context.Context, dataList []SensorData) error {
	points := make([]*influxdb2.Point, len(dataList))
	for i, data := range dataList {
		points[i] = influxdb2.NewPointWithMeasurement("sensor_data").
			AddTag("device_id", data.DeviceID).
			AddField("temperature", data.Temp).
			AddField("vibration", data.Vibration).
			AddField("current", data.Current).
			SetTime(data.Timestamp)
	}
	return c.writeAPI.WritePoint(ctx, points...)
}

func (c *Client) QuerySensorData(ctx context.Context, deviceID string, startTime, endTime time.Time) ([]SensorData, error) {
	query := `from(bucket: "` + c.bucket + `")
		|> range(start: ` + startTime.Format(time.RFC3339) + `, stop: ` + endTime.Format(time.RFC3339) + `)
		|> filter(fn: (r) => r._measurement == "sensor_data" and r.device_id == "` + deviceID + `")
		|> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
		|> sort(columns: ["_time"])`

	result, err := c.queryAPI.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer result.Close()

	var dataList []SensorData
	for result.Next() {
		record := result.Record()
		data := SensorData{
			DeviceID:  deviceID,
			Timestamp: record.Time(),
		}

		if temp, ok := record.ValueByKey("temperature").(float64); ok {
			data.Temp = temp
		}
		if vib, ok := record.ValueByKey("vibration").(float64); ok {
			data.Vibration = vib
		}
		if curr, ok := record.ValueByKey("current").(float64); ok {
			data.Current = curr
		}

		dataList = append(dataList, data)
	}

	return dataList, result.Err()
}

func (c *Client) Close() {
	c.client.Close()
}
