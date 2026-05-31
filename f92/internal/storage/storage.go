// Package storage persists profile runs for later replay. It supports two
// backends:
//
//   - Disk: writes folded text into a local directory with a JSON manifest.
//   - S3:   PUTs the same payload into an S3 bucket under a configurable
//           prefix.
//
// The two backends share the ProfileRecord and query interface, so higher
// layers can treat them interchangeably.
package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// ProfileRecord is the canonical on-disk / on-wire representation of a
// completed profile run.
type ProfileRecord struct {
	ID             string    `json:"id"`
	TargetPID      int       `json:"target_pid"`
	TargetName     string    `json:"target_name,omitempty"`
	DurationSec    int       `json:"duration_sec"`
	SampleHz       int       `json:"sample_hz"`
	TotalSamples   uint64    `json:"total_samples"`
	DroppedSamples uint64    `json:"dropped_samples"`
	StartedAt      time.Time `json:"started_at"`
	EndedAt        time.Time `json:"ended_at"`
	Folded         string    `json:"folded"`
	Backend        string    `json:"backend"`
}

// Backend abstracts the persistence layer.
type Backend interface {
	Save(ctx context.Context, rec ProfileRecord) error
	Load(ctx context.Context, id string) (*ProfileRecord, error)
	List(ctx context.Context, query ListQuery) ([]ProfileRecord, error)
	Delete(ctx context.Context, id string) error
	Close() error
}

// ListQuery limits which records are returned by List.
type ListQuery struct {
	TargetName  string
	TargetPID   int
	Since, Until time.Time
	Limit       int
}

// ---------------------------------------------------------------------------
// Disk backend
// ---------------------------------------------------------------------------

// DiskBackend stores profile records as JSON files under a single root.
type DiskBackend struct {
	root string
	mu   sync.RWMutex
}

// NewDiskBackend creates (or verifies) a local storage directory.
func NewDiskBackend(root string) (*DiskBackend, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &DiskBackend{root: root}, nil
}

func (d *DiskBackend) pathFor(id string) string {
	return filepath.Join(d.root, id+".json")
}

func (d *DiskBackend) Save(_ context.Context, rec ProfileRecord) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	data, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(d.pathFor(rec.ID), data, 0o644)
}

func (d *DiskBackend) Load(_ context.Context, id string) (*ProfileRecord, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	data, err := os.ReadFile(d.pathFor(id))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	var rec ProfileRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (d *DiskBackend) List(_ context.Context, q ListQuery) ([]ProfileRecord, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	entries, err := os.ReadDir(d.root)
	if err != nil {
		return nil, err
	}
	var out []ProfileRecord
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(d.root, e.Name()))
		if err != nil {
			continue
		}
		var rec ProfileRecord
		if err := json.Unmarshal(data, &rec); err != nil {
			continue
		}
		if matches(rec, q) {
			out = append(out, rec)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	if q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	return out, nil
}

func (d *DiskBackend) Delete(_ context.Context, id string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	err := os.Remove(d.pathFor(id))
	if os.IsNotExist(err) {
		return ErrNotFound
	}
	return err
}

func (d *DiskBackend) Close() error { return nil }

// ---------------------------------------------------------------------------
// S3 backend
// ---------------------------------------------------------------------------

// S3Backend stores profile records in an S3 bucket.
type S3Backend struct {
	client *s3.Client
	bucket string
	prefix string
}

// NewS3Backend creates an S3 backend using the default AWS config loader
// (environment, ~/.aws, EC2 metadata, etc.). If the caller wants static
// credentials they should use the AWS_* environment variables or pass a
// pre-built *s3.Client via NewS3BackendFromClient.
func NewS3Backend(ctx context.Context, bucket, prefix string) (*S3Backend, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	return NewS3BackendFromClient(s3.NewFromConfig(cfg), bucket, prefix), nil
}

// NewS3BackendFromClient is useful for tests or custom credential flows.
func NewS3BackendFromClient(c *s3.Client, bucket, prefix string) *S3Backend {
	if !strings.HasSuffix(prefix, "/") && prefix != "" {
		prefix += "/"
	}
	return &S3Backend{client: c, bucket: bucket, prefix: prefix}
}

func (s *S3Backend) keyFor(id string) string {
	if s.prefix == "" {
		return id + ".json"
	}
	return s.prefix + id + ".json"
}

func (s *S3Backend) Save(ctx context.Context, rec ProfileRecord) error {
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	_, err = s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.keyFor(rec.ID)),
		Body:   strings.NewReader(string(data)),
	})
	return err
}

func (s *S3Backend) Load(ctx context.Context, id string) (*ProfileRecord, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.keyFor(id)),
	})
	if err != nil {
		var nsk *types.NoSuchKey
		if errors.As(err, &nsk) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	defer out.Body.Close()
	data, err := io.ReadAll(out.Body)
	if err != nil {
		return nil, err
	}
	var rec ProfileRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *S3Backend) List(ctx context.Context, q ListQuery) ([]ProfileRecord, error) {
	var (
		out    []ProfileRecord
		token  *string
		loaded int
	)
	for {
		resp, err := s.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket:            aws.String(s.bucket),
			Prefix:            aws.String(s.prefix),
			ContinuationToken: token,
		})
		if err != nil {
			return nil, err
		}
		for _, obj := range resp.Contents {
			if q.Limit > 0 && loaded >= q.Limit {
				break
			}
			rec, err := s.Load(ctx, strings.TrimPrefix(*obj.Key, s.prefix))
			if err != nil {
				continue
			}
			if matches(*rec, q) {
				out = append(out, *rec)
				loaded++
			}
		}
		if resp.NextContinuationToken == nil || (q.Limit > 0 && loaded >= q.Limit) {
			break
		}
		token = resp.NextContinuationToken
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out, nil
}

func (s *S3Backend) Delete(ctx context.Context, id string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.keyFor(id)),
	})
	return err
}

func (s *S3Backend) Close() error { return nil }

// ---------------------------------------------------------------------------
// Shared query helpers
// ---------------------------------------------------------------------------

// ErrNotFound is returned by Load when the record does not exist.
var ErrNotFound = errors.New("profile record not found")

func matches(rec ProfileRecord, q ListQuery) bool {
	if q.TargetName != "" && rec.TargetName != q.TargetName {
		return false
	}
	if q.TargetPID > 0 && rec.TargetPID != q.TargetPID {
		return false
	}
	if !q.Since.IsZero() && rec.StartedAt.Before(q.Since) {
		return false
	}
	if !q.Until.IsZero() && rec.EndedAt.After(q.Until) {
		return false
	}
	return true
}
