package backend

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"sync"

	"github.com/consensys/gnark/backend/groth16"
	"golang.org/x/crypto/hkdf"
	"zk-voting-system/merkle"
	"zk-voting-system/zk"
)

type Poll struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Description     string            `json:"description"`
	MerkleRoot      string            `json:"merkle_root"`
	Nullifiers      map[string]bool   `json:"nullifiers"`
	Nonces          map[string]bool   `json:"nonces"`
	Votes           []StoredVote      `json:"votes"`
	CreatedAt       int64             `json:"created_at"`
	IsActive        bool              `json:"is_active"`
	IsTallied       bool              `json:"is_tallied"`
	TallyResult     TallyResult       `json:"tally_result,omitempty"`
	AggregateProof  []byte            `json:"aggregate_proof,omitempty"`
	EncryptedBackup []byte            `json:"encrypted_backup,omitempty"`
	BackupSalt      []byte            `json:"backup_salt,omitempty"`
}

type StoredVote struct {
	Nullifier   string `json:"nullifier"`
	Nonce       string `json:"nonce"`
	ProofBytes  []byte `json:"proof_bytes"`
	SubmittedAt int64  `json:"submitted_at"`
}

type TallyResult struct {
	Count1     int `json:"count1"`
	Count2     int `json:"count2"`
	Count3     int `json:"count3"`
	TotalVotes int `json:"total_votes"`
}

type ProofExport struct {
	PollID         string       `json:"poll_id"`
	MerkleRoot     string       `json:"merkle_root"`
	Votes          []VoteExport `json:"votes"`
	TallyResult    TallyResult  `json:"tally_result"`
	AggregateProof []byte       `json:"aggregate_proof"`
}

type VoteExport struct {
	Nullifier  string `json:"nullifier"`
	Nonce      string `json:"nonce"`
	ProofBytes []byte `json:"proof_bytes"`
}

type Storage struct {
	mu        sync.RWMutex
	polls     map[string]*Poll
	whitelist map[string][]byte
	setup     *zk.SetupOutput
}

func NewStorage() *Storage {
	return &Storage{
		polls:     make(map[string]*Poll),
		whitelist: make(map[string][]byte),
	}
}

func (s *Storage) SetSetup(setup *zk.SetupOutput) {
	s.setup = setup
}

func (s *Storage) GetSetup() *zk.SetupOutput {
	return s.setup
}

func (s *Storage) AddToWhitelist(pubKey []byte) int {
	s.mu.Lock()
	defer s.mu.Unlock()

	hash := hex.EncodeToString(merkle.PubKeyToLeaf(pubKey))
	if _, exists := s.whitelist[hash]; !exists {
		s.whitelist[hash] = pubKey
	}
	return len(s.whitelist) - 1
}

func (s *Storage) GetWhitelist() [][]byte {
	s.mu.RLock()
	defer s.mu.RUnlock()

	leaves := make([][]byte, 0, len(s.whitelist))
	for _, pubKey := range s.whitelist {
		leaves = append(leaves, merkle.PubKeyToLeaf(pubKey))
	}
	return leaves
}

func (s *Storage) GetMerkleProof(pubKey []byte) (*merkle.Proof, []byte, int, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	hash := hex.EncodeToString(merkle.PubKeyToLeaf(pubKey))
	pubKeyData, exists := s.whitelist[hash]
	if !exists {
		return nil, nil, -1, false
	}

	leaves := s.GetWhitelist()
	mt := merkle.NewMerkleTree(leaves)

	var index int
	for i, leaf := range leaves {
		if hex.EncodeToString(leaf) == hex.EncodeToString(merkle.PubKeyToLeaf(pubKeyData)) {
			index = i
			break
		}
	}

	proof, err := mt.GenerateProof(index)
	if err != nil {
		return nil, nil, -1, false
	}

	return proof, mt.Root, index, true
}

func (s *Storage) CreatePoll(id, name, description string, merkleRoot string, createdAt int64) *Poll {
	s.mu.Lock()
	defer s.mu.Unlock()

	poll := &Poll{
		ID:          id,
		Name:        name,
		Description: description,
		MerkleRoot:  merkleRoot,
		Nullifiers:  make(map[string]bool),
		Nonces:      make(map[string]bool),
		Votes:       make([]StoredVote, 0),
		CreatedAt:   createdAt,
		IsActive:    true,
		IsTallied:   false,
	}

	s.polls[id] = poll
	return poll
}

func (s *Storage) GetPoll(id string) (*Poll, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	poll, exists := s.polls[id]
	return poll, exists
}

func (s *Storage) GetAllPolls() []*Poll {
	s.mu.RLock()
	defer s.mu.RUnlock()

	polls := make([]*Poll, 0, len(s.polls))
	for _, poll := range s.polls {
		polls = append(polls, poll)
	}
	return polls
}

func GenerateNonce() string {
	nonceBytes := make([]byte, 32)
	rand.Read(nonceBytes)
	return hex.EncodeToString(nonceBytes)
}

func (s *Storage) CastVote(pollID string, proof *zk.VoteProof, nonce string, proofBytes []byte, submittedAt int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	poll, exists := s.polls[pollID]
	if !exists {
		return os.ErrNotExist
	}

	nullifierHex := hex.EncodeToString(proof.Nullifier)
	if poll.Nullifiers[nullifierHex] {
		return os.ErrExist
	}

	if poll.Nonces[nonce] {
		return os.ErrExist
	}

	poll.Nullifiers[nullifierHex] = true
	poll.Nonces[nonce] = true
	poll.Votes = append(poll.Votes, StoredVote{
		Nullifier:   nullifierHex,
		Nonce:       nonce,
		ProofBytes:  proofBytes,
		SubmittedAt: submittedAt,
	})

	return nil
}

func (s *Storage) GetVoteCount(pollID string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()

	poll, exists := s.polls[pollID]
	if !exists {
		return 0
	}
	return len(poll.Votes)
}

func (s *Storage) GetAllNullifiers(pollID string) ([][]byte, []string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	poll, exists := s.polls[pollID]
	if !exists {
		return nil, nil, false
	}

	nullifiers := make([][]byte, len(poll.Votes))
	nonces := make([]string, len(poll.Votes))
	for i, vote := range poll.Votes {
		nullifierBytes, _ := hex.DecodeString(vote.Nullifier)
		nullifiers[i] = nullifierBytes
		nonces[i] = vote.Nonce
	}

	return nullifiers, nonces, true
}

func (s *Storage) ClosePoll(pollID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	poll, exists := s.polls[pollID]
	if !exists {
		return false
	}
	poll.IsActive = false
	return true
}

func (s *Storage) SetTallyResult(pollID string, count1, count2, count3 int, aggregateProof []byte) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	poll, exists := s.polls[pollID]
	if !exists {
		return false
	}

	poll.IsTallied = true
	poll.TallyResult = TallyResult{
		Count1:     count1,
		Count2:     count2,
		Count3:     count3,
		TotalVotes: len(poll.Votes),
	}
	poll.AggregateProof = aggregateProof
	return true
}

func (s *Storage) ExportProofs(pollID string) (*ProofExport, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	poll, exists := s.polls[pollID]
	if !exists {
		return nil, false
	}

	votes := make([]VoteExport, len(poll.Votes))
	for i, v := range poll.Votes {
		votes[i] = VoteExport{
			Nullifier:  v.Nullifier,
			Nonce:      v.Nonce,
			ProofBytes: v.ProofBytes,
		}
	}

	return &ProofExport{
		PollID:         poll.ID,
		MerkleRoot:     poll.MerkleRoot,
		Votes:          votes,
		TallyResult:    poll.TallyResult,
		AggregateProof: poll.AggregateProof,
	}, true
}

func (s *Storage) CreateEncryptedBackup(pollID string, password string) ([]byte, []byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	poll, exists := s.polls[pollID]
	if !exists {
		return nil, nil, os.ErrNotExist
	}

	votes := make([]VoteExport, len(poll.Votes))
	for i, v := range poll.Votes {
		votes[i] = VoteExport{
			Nullifier:  v.Nullifier,
			Nonce:      v.Nonce,
			ProofBytes: v.ProofBytes,
		}
	}

	export := ProofExport{
		PollID:         poll.ID,
		MerkleRoot:     poll.MerkleRoot,
		Votes:          votes,
		TallyResult:    poll.TallyResult,
		AggregateProof: poll.AggregateProof,
	}

	plaintext, err := json.Marshal(export)
	if err != nil {
		return nil, nil, err
	}

	salt := make([]byte, 32)
	if _, err := rand.Read(salt); err != nil {
		return nil, nil, err
	}

	key := deriveKey(password, salt)

	encrypted, err := encryptAES(plaintext, key)
	if err != nil {
		return nil, nil, err
	}

	poll.EncryptedBackup = encrypted
	poll.BackupSalt = salt

	return encrypted, salt, nil
}

func (s *Storage) GetEncryptedBackup(pollID string) ([]byte, []byte, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	poll, exists := s.polls[pollID]
	if !exists || len(poll.EncryptedBackup) == 0 {
		return nil, nil, false
	}

	return poll.EncryptedBackup, poll.BackupSalt, true
}

func DecryptBackup(encrypted []byte, salt []byte, password string) (*ProofExport, error) {
	key := deriveKey(password, salt)

	plaintext, err := decryptAES(encrypted, key)
	if err != nil {
		return nil, err
	}

	var export ProofExport
	err = json.Unmarshal(plaintext, &export)
	if err != nil {
		return nil, err
	}

	return &export, nil
}

func deriveKey(password string, salt []byte) []byte {
	hash := hkdf.New(sha256.New, []byte(password), salt, []byte("zk-voting-backup"))
	key := make([]byte, 32)
	io.ReadFull(hash, key)
	return key
}

func encryptAES(plaintext []byte, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}

	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return ciphertext, nil
}

func decryptAES(ciphertext []byte, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, os.ErrInvalid
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}

func (s *Storage) SaveToFile(path string) error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := json.MarshalIndent(s.polls, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

func (s *Storage) LoadFromFile(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	return json.Unmarshal(data, &s.polls)
}

func ProofToBytes(proof groth16.Proof) ([]byte, error) {
	return json.Marshal(proof)
}

func BytesToProof(data []byte) (groth16.Proof, error) {
	var proof groth16.Proof
	err := json.Unmarshal(data, &proof)
	return proof, err
}
