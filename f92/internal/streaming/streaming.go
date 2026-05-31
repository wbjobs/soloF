// Package streaming implements continuous (streaming) profiling.
//
// A Session repeatedly runs the eBPF sampler for short, fixed-duration
// windows and publishes intermediate results to any subscribers. Results
// are also persisted to the storage backend so they can be replayed later
// via the history API.
package streaming

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ebpf-profiler/profiler/internal/proc"
	"github.com/ebpf-profiler/profiler/internal/profiler"
	"github.com/ebpf-profiler/profiler/internal/storage"
)

// Tick holds one batch of sampling data produced by a streaming session.
type Tick struct {
	SessionID      string    `json:"session_id"`
	TargetPID      int       `json:"target_pid"`
	TargetName     string    `json:"target_name,omitempty"`
	Batch          int       `json:"batch"`
	Folded         string    `json:"folded"`
	TotalSamples   uint64    `json:"total_samples"`
	DroppedSamples uint64    `json:"dropped_samples"`
	StartedAt      time.Time `json:"started_at"`
	EndedAt        time.Time `json:"ended_at"`
}

// newID returns a 32-character hex session identifier.
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

// SessionConfig controls a streaming session.
type SessionConfig struct {
	TargetPID   int
	TargetName  string
	Tick        time.Duration // sampling window per batch, default 3s
	PushEvery   time.Duration // how often to emit ticks, default 3s
	SampleHz    int
	ObjectPath  string
	Persist     bool // when true, each tick is saved to storage
}

// Session is a long-lived continuous profiling session.
type Session struct {
	cfg      SessionConfig
	id       string
	batch    uint64

	storage  storage.Backend
	tracker  *proc.Tracker
	currentPIDs []int

	mu         sync.RWMutex
	subs       map[chan Tick]struct{}
	startedAt  time.Time
	stopped    atomic.Bool
	cancel     context.CancelFunc
	wg         sync.WaitGroup
}

// Manager is the in-memory registry of active sessions.
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	storage  storage.Backend
}

// NewManager creates a session manager that persists ticks to the given
// storage backend.
func NewManager(s storage.Backend) *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
		storage:  s,
	}
}

// Start begins a new streaming session. If TargetName is set, a process
// tracker is created and the session re-targets automatically when the
// original PID exits (following fork / exec).
func (m *Manager) Start(ctx context.Context, cfg SessionConfig) (*Session, error) {
	if cfg.Tick <= 0 {
		cfg.Tick = 3 * time.Second
	}
	if cfg.PushEvery <= 0 {
		cfg.PushEvery = cfg.Tick
	}
	if cfg.SampleHz <= 0 {
		cfg.SampleHz = 99
	}

	if cfg.TargetPID <= 0 && cfg.TargetName == "" {
		return nil, fmt.Errorf("target pid or target name is required")
	}

	// If only a name is given, resolve the first matching PID.
	if cfg.TargetPID <= 0 {
		pids, err := proc.FindByName(cfg.TargetName)
		if err != nil {
			return nil, fmt.Errorf("resolve target name: %w", err)
		}
		cfg.TargetPID = pids[0]
	} else if cfg.TargetName == "" {
		// Resolve the name for display / persistence.
		if info, err := proc.Read(cfg.TargetPID); err == nil {
			cfg.TargetName = info.Name
		}
	}

	s := &Session{
		cfg:       cfg,
		id:        newID(),
		storage:   m.storage,
		subs:      make(map[chan Tick]struct{}),
		startedAt: time.Now(),
	}

	// Start a process tracker for fork / exec following.
	if cfg.TargetName != "" {
		s.tracker = proc.StartTracker(cfg.TargetName, 1*time.Second)
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			for ev := range s.tracker.Events() {
				switch ev.Type {
				case proc.EventAppeared:
					s.mu.Lock()
					found := false
					for _, p := range s.currentPIDs {
						if p == ev.PID {
							found = true
							break
						}
					}
					if !found {
						s.currentPIDs = append(s.currentPIDs, ev.PID)
					}
					s.mu.Unlock()
				case proc.EventDisappeared:
					s.mu.Lock()
					for i, p := range s.currentPIDs {
						if p == ev.PID {
							s.currentPIDs = append(s.currentPIDs[:i], s.currentPIDs[i+1:]...)
							break
						}
					}
					s.mu.Unlock()
				}
			}
		}()
		s.currentPIDs = s.tracker.Current()
	} else {
		s.currentPIDs = []int{cfg.TargetPID}
	}

	runCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.wg.Add(1)
	go s.run(runCtx)

	m.mu.Lock()
	m.sessions[s.id] = s
	m.mu.Unlock()

	return s, nil
}

// Stop halts a session and removes it from the registry.
func (m *Manager) Stop(id string) {
	m.mu.Lock()
	s, ok := m.sessions[id]
	m.mu.Unlock()
	if !ok {
		return
	}
	s.Stop()
	m.mu.Lock()
	delete(m.sessions, id)
	m.mu.Unlock()
}

// Get returns a session by ID.
func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[id]
	return s, ok
}

// List returns all active sessions.
func (m *Manager) List() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s)
	}
	return out
}

// ID returns the unique session identifier.
func (s *Session) ID() string { return s.id }

// Config returns the session configuration (for JSON serialisation).
func (s *Session) Config() SessionConfig { return s.cfg }

// StartedAt returns when the session started.
func (s *Session) StartedAt() time.Time { return s.startedAt }

// Subscribe returns a channel that receives every Tick emitted by the
// session. The caller MUST call Unsubscribe when done to avoid leaking the
// channel.
func (s *Session) Subscribe() chan Tick {
	ch := make(chan Tick, 64)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return ch
}

// Unsubscribe stops delivery for a previously returned channel.
func (s *Session) Unsubscribe(ch chan Tick) {
	s.mu.Lock()
	delete(s.subs, ch)
	close(ch)
	s.mu.Unlock()
}

// Stop halts the session. Safe to call multiple times.
func (s *Session) Stop() {
	if !s.stopped.CompareAndSwap(false, true) {
		return
	}
	if s.cancel != nil {
		s.cancel()
	}
	if s.tracker != nil {
		s.tracker.Stop()
	}
	s.wg.Wait()

	// Close any subscribed channels so readers wake up.
	s.mu.Lock()
	for ch := range s.subs {
		close(ch)
	}
	s.subs = nil
	s.mu.Unlock()
}

// run is the main loop: each iteration performs one short profile and
// broadcasts the result.
func (s *Session) run(ctx context.Context) {
	defer s.wg.Done()

	ticker := time.NewTicker(s.cfg.Tick)
	defer ticker.Stop()

	// Run an initial batch immediately.
	s.runOnce(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.runOnce(ctx)
		}
	}
}

func (s *Session) runOnce(ctx context.Context) {
	// Pick the first currently tracked PID. If none, wait for the next
	// tick (the tracker will eventually find a replacement).
	s.mu.RLock()
	var pid int
	if len(s.currentPIDs) > 0 {
		pid = s.currentPIDs[0]
	}
	s.mu.RUnlock()
	if pid == 0 {
		return
	}

	batch := atomic.AddUint64(&s.batch, 1)
	start := time.Now()

	res, err := profiler.Profile(ctx, profiler.Options{
		PID:        pid,
		Duration:   s.cfg.Tick,
		SampleHz:   s.cfg.SampleHz,
		ObjectPath: s.cfg.ObjectPath,
	})
	end := time.Now()

	if err != nil {
		// Session-level errors (e.g. the target PID exiting) are non-fatal;
		// the tracker will re-target on the next iteration if a name was
		// provided.
		return
	}

	t := Tick{
		SessionID:      s.id,
		TargetPID:      pid,
		TargetName:     s.cfg.TargetName,
		Batch:          int(batch),
		Folded:         res.Folded,
		TotalSamples:   res.TotalSamples,
		DroppedSamples: res.DroppedSamples,
		StartedAt:      start,
		EndedAt:        end,
	}

	// Persist if requested.
	if s.cfg.Persist && s.storage != nil {
		rec := storage.ProfileRecord{
			ID:             fmt.Sprintf("%s-%d", s.id, batch),
			TargetPID:      pid,
			TargetName:     s.cfg.TargetName,
			DurationSec:    int(s.cfg.Tick.Seconds()),
			SampleHz:       s.cfg.SampleHz,
			TotalSamples:   res.TotalSamples,
			DroppedSamples: res.DroppedSamples,
			StartedAt:      start,
			EndedAt:        end,
			Folded:         res.Folded,
			Backend:        "streaming",
		}
		_ = s.storage.Save(ctx, rec)
	}

	// Broadcast to subscribers.
	s.mu.RLock()
	for ch := range s.subs {
		select {
		case ch <- t:
		default:
			// Drop if the subscriber can't keep up.
		}
	}
	s.mu.RUnlock()
}
