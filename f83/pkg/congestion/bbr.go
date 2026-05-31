package congestion

import (
	"math"
	"sync"
	"time"
)

const (
	RTTFilterLength = 10
	BTLFilterLength = 10
	HighLossRate    = 0.1
	LossWindow      = 100
)

type BBRState int

const (
	BBRStartup BBRState = iota
	BBRDrain
	BBRProbeBW
	BBRProbeRTT
)

type BBR struct {
	mu sync.RWMutex

	state BBRState
	
	minRTT   time.Duration
	rtFilter []time.Duration
	
	btlBW    float64
	bwFilter []float64
	
	bandwidth float64
	cwnd      int
	
	pacingRate   float64
	pacingGain   float64
	cwndGain     float64
	
	delivered       int
	deliveredTime   time.Time
	
	roundCount      int
	probeRTTDone    bool
	probeRTTStartTime time.Time
	
	startupRound    int
	filledPipe      bool
	
	packetsSent     int
	packetsLost     int
	lossRate        float64
}

func NewBBR() *BBR {
	return &BBR{
		state:         BBRStartup,
		rtFilter:      make([]time.Duration, 0, RTTFilterLength),
		bwFilter:      make([]float64, 0, BTLFilterLength),
		cwnd:          10,
		pacingGain:    2.885,
		cwndGain:      2.885,
		deliveredTime: time.Now(),
	}
}

func (b *BBR) OnPacketSent(pktSize int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	
	b.packetsSent++
	if b.packetsSent > LossWindow*2 {
		b.packetsSent = b.packetsSent/2
		b.packetsLost = b.packetsLost/2
	}
}

func (b *BBR) OnPacketAcked(pktSize int, rtt time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	
	b.updateRTT(rtt)
	
	now := time.Now()
	deliveredTime := now.Sub(b.deliveredTime)
	if deliveredTime > 0 {
		bw := float64(pktSize) / deliveredTime.Seconds()
		b.updateBandwidth(bw)
	}
	
	b.delivered += pktSize
	b.deliveredTime = now
	
	b.updateLossRate()
	b.updateState()
	b.updatePacingRate()
	b.updateCwnd()
}

func (b *BBR) OnPacketLost(pktSize int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	
	b.packetsLost++
	
	if b.lossRate > HighLossRate {
		b.pacingGain = math.Min(b.pacingGain, 0.75)
		b.cwndGain = math.Min(b.cwndGain, 1.0)
	}
	
	if b.cwnd > 2 {
		b.cwnd = b.cwnd * 3 / 4
	}
	
	b.updateLossRate()
	b.updateCwnd()
}

func (b *BBR) updateLossRate() {
	if b.packetsSent > LossWindow {
		b.lossRate = float64(b.packetsLost) / float64(b.packetsSent)
	}
}

func (b *BBR) updateRTT(rtt time.Duration) {
	if rtt <= 0 {
		return
	}
	
	b.rtFilter = append(b.rtFilter, rtt)
	if len(b.rtFilter) > RTTFilterLength {
		b.rtFilter = b.rtFilter[1:]
	}
	
	minRTT := b.rtFilter[0]
	for _, r := range b.rtFilter {
		if r < minRTT {
			minRTT = r
		}
	}
	b.minRTT = minRTT
}

func (b *BBR) updateBandwidth(bw float64) {
	b.bwFilter = append(b.bwFilter, bw)
	if len(b.bwFilter) > BTLFilterLength {
		b.bwFilter = b.bwFilter[1:]
	}
	
	maxBW := 0.0
	for _, b := range b.bwFilter {
		if b > maxBW {
			maxBW = b
		}
	}
	b.btlBW = maxBW
}

func (b *BBR) updateState() {
	switch b.state {
	case BBRStartup:
		b.handleStartup()
	case BBRDrain:
		b.handleDrain()
	case BBRProbeBW:
		b.handleProbeBW()
	case BBRProbeRTT:
		b.handleProbeRTT()
	}
}

func (b *BBR) handleStartup() {
	if b.lossRate > HighLossRate {
		b.pacingGain = 1.5
		b.cwndGain = 1.5
	} else {
		b.pacingGain = 2.885
		b.cwndGain = 2.885
	}
	
	b.roundCount++
	
	if b.roundCount-b.startupRound >= 3 {
		bwGrowth := (b.btlBW - b.bandwidth) / math.Max(b.bandwidth, 1)
		if bwGrowth < 0.25 || b.lossRate > HighLossRate {
			b.filledPipe = true
			b.state = BBRDrain
		}
	}
	b.bandwidth = b.btlBW
}

func (b *BBR) handleDrain() {
	if b.lossRate > HighLossRate {
		b.pacingGain = 0.5
	} else {
		b.pacingGain = 1 / 2.885
	}
	b.cwndGain = 2.885
	
	if float64(b.cwnd) <= b.targetCWND() || b.lossRate > HighLossRate {
		b.state = BBRProbeBW
	}
}

func (b *BBR) handleProbeBW() {
	gains := []float64{1.25, 0.75, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0}
	
	if b.lossRate > HighLossRate {
		gains = []float64{0.75, 0.5, 0.75, 1.0, 0.5, 1.0, 0.75, 1.0}
		b.cwndGain = 1.0
	} else {
		b.cwndGain = 2.0
	}
	
	phase := b.roundCount % len(gains)
	b.pacingGain = gains[phase]
	
	if b.minRTT > 0 && b.roundCount%10 == 0 {
		b.state = BBRProbeRTT
		b.probeRTTStartTime = time.Now()
		b.probeRTTDone = false
	}
}

func (b *BBR) handleProbeRTT() {
	b.pacingGain = 1.0
	b.cwndGain = 0.5
	
	if !b.probeRTTDone && time.Since(b.probeRTTStartTime) >= b.minRTT {
		b.probeRTTDone = true
	}
	
	if b.probeRTTDone && time.Since(b.probeRTTStartTime) >= 200*time.Millisecond {
		b.state = BBRProbeBW
		b.startupRound = b.roundCount
	}
}

func (b *BBR) updatePacingRate() {
	if b.minRTT > 0 {
		baseRate := float64(b.btlBW) * b.pacingGain
		
		if b.lossRate > HighLossRate {
			lossFactor := 1.0 - b.lossRate
			if lossFactor < 0.3 {
				lossFactor = 0.3
			}
			baseRate *= lossFactor
		}
		
		b.pacingRate = baseRate
	}
}

func (b *BBR) targetCWND() float64 {
	if b.minRTT <= 0 {
		return 10
	}
	
	target := b.btlBW * b.minRTT.Seconds() * b.cwndGain
	
	if b.lossRate > HighLossRate {
		lossFactor := 1.0 - b.lossRate
		if lossFactor < 0.3 {
			lossFactor = 0.3
		}
		target *= lossFactor
	}
	
	return target
}

func (b *BBR) updateCwnd() {
	target := int(b.targetCWND())
	
	if target < 2 {
		target = 2
	}
	
	if b.cwnd < target {
		b.cwnd++
	} else if b.cwnd > target*2 {
		b.cwnd--
	}
	
	if b.cwnd < 2 {
		b.cwnd = 2
	}
}

func (b *BBR) GetCWND() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.cwnd
}

func (b *BBR) GetPacingRate() float64 {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.pacingRate
}

func (b *BBR) GetRTT() time.Duration {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.minRTT
}

func (b *BBR) GetBandwidth() float64 {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.btlBW
}

func (b *BBR) GetState() BBRState {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.state
}

func (b *BBR) GetLossRate() float64 {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.lossRate
}

func (b *BBR) CanSend(inFlight int) bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	
	cwndLimit := inFlight < b.cwnd
	
	var pacingLimit bool
	if b.pacingRate <= 0 {
		pacingLimit = true
	} else {
		pacingLimit = true
	}
	
	return cwndLimit && pacingLimit
}
