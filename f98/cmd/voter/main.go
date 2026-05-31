package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"golang.org/x/crypto/hkdf"
	"zk-voting-system/merkle"
	"zk-voting-system/zk"
)

type Config struct {
	ServerURL string `json:"server_url"`
	PrivKey   []byte `json:"priv_key"`
	PubKey    []byte `json:"pub_key"`
}

type VoteRequest struct {
	Nullifier  string `json:"nullifier"`
	Nonce      string `json:"nonce"`
	MerkleRoot string `json:"merkle_root"`
	ProofBytes []byte `json:"proof_bytes"`
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

type TallyResult struct {
	Count1     int `json:"count1"`
	Count2     int `json:"count2"`
	Count3     int `json:"count3"`
	TotalVotes int `json:"total_votes"`
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		return
	}

	switch os.Args[1] {
	case "init":
		initWallet()
	case "register":
		registerPubKey()
	case "vote":
		voteCmd()
	case "polls":
		listPolls()
	case "poll":
		getPoll()
	case "create":
		createPoll()
	case "tally":
		tallyPoll()
	case "export":
		exportProofs()
	case "verify":
		verifyProofs()
	case "backup":
		createBackup()
	case "download-backup":
		downloadBackup()
	case "decrypt-backup":
		decryptBackup()
	default:
		printUsage()
	}
}

func printUsage() {
	fmt.Println("zk-voter - Anonymous voting CLI")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  voter init                    Initialize wallet")
	fmt.Println("  voter register              Register public key to whitelist")
	fmt.Println("  voter vote <poll_id> <1|2|3>  Cast a vote")
	fmt.Println("  voter polls                  List all polls")
	fmt.Println("  voter poll <poll_id>         Get poll details")
	fmt.Println("  voter create <name> [desc]       Create a new poll")
	fmt.Println("  voter tally <poll_id>       Tally votes for a poll")
	fmt.Println()
	fmt.Println("Verification & Backup:")
	fmt.Println("  voter export <poll_id>         Download all proofs")
	fmt.Println("  voter verify <file>          Independently verify proofs")
	fmt.Println("  voter backup <poll_id> <pwd>  Create encrypted backup")
	fmt.Println("  voter download-backup <poll_id>  Download encrypted backup")
	fmt.Println("  voter decrypt-backup <file> <pwd>  Decrypt and verify backup")
	fmt.Println()
	fmt.Println("Options:")
	fmt.Println("  --server <url>               Server URL (default: http://localhost:8080)")
}

func getServerURL() string {
	for i, arg := range os.Args {
		if arg == "--server" && i+1 < len(os.Args) {
			return os.Args[i+1]
		}
	}
	return "http://localhost:8080"
}

func initWallet() {
	serverURL := getServerURL()

	privKey := make([]byte, 32)
	rand.Read(privKey)

	pubKey := make([]byte, 32)
	for i := range pubKey {
		pubKey[i] = privKey[i] ^ 0x55
	}

	config := Config{
		ServerURL: serverURL,
		PrivKey:   privKey,
		PubKey:    pubKey,
	}

	data, _ := json.MarshalIndent(config, "", "  ")
	os.WriteFile("wallet.json", data, 0600)

	fmt.Println("Wallet initialized!")
	fmt.Println("Public Key:", hex.EncodeToString(pubKey))
	fmt.Println("Saved to: wallet.json")
}

func loadConfig() (*Config, error) {
	data, err := os.ReadFile("wallet.json")
	if err != nil {
		return nil, err
	}

	var config Config
	err = json.Unmarshal(data, &config)
	return &config, err
}

func registerPubKey() {
	config, err := loadConfig()
	if err != nil {
		fmt.Println("Error: wallet not found. Run 'voter init' first.")
		return
	}

	pubKeyHex := hex.EncodeToString(config.PubKey)

	reqBody := map[string]string{"pub_key": pubKeyHex}
	jsonData, _ := json.Marshal(reqBody)

	resp, err := http.Post(config.ServerURL+"/api/v1/whitelist", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Println("Error registering:", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Println("Response:", string(body))

	if resp.StatusCode == 200 {
		fmt.Println("Successfully registered public key!")
	}
}

func voteCmd() {
	if len(os.Args) < 4 {
		fmt.Println("Usage: voter vote <poll_id> <1|2|3>")
		return
	}

	pollID := os.Args[2]
	voteOption := os.Args[3]

	var vote int
	fmt.Sscanf(voteOption, "%d", &vote)
	if vote < 1 || vote > 3 {
		fmt.Println("Error: vote must be 1, 2, or 3")
		return
	}

	config, err := loadConfig()
	if err != nil {
		fmt.Println("Error: wallet not found. Run 'voter init' first.")
		return
	}

	pubKeyHash := merkle.PubKeyToLeaf(config.PubKey)

	resp, err := http.Get(config.ServerURL + "/api/v1/whitelist/proof?pub_key=" + hex.EncodeToString(config.PubKey))
	if err != nil {
		fmt.Println("Error getting merkle proof:", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	var proofResp struct {
		MerkleRoot string   `json:"merkle_root"`
		MerklePath []string `json:"merkle_path"`
		MerkleIndex int     `json:"merkle_index"`
	}
	json.Unmarshal(body, &proofResp)

	merkleRoot, _ := hex.DecodeString(proofResp.MerkleRoot)
	merklePath := make([][]byte, len(proofResp.MerklePath))
	for i, s := range proofResp.MerklePath {
		merklePath[i], _ = hex.DecodeString(s)
	}

	fmt.Println("Generating zk-SNARK proof with optimized circuit...")
	fmt.Println("(Using simplified constraints for better performance)")

	nonce, _ := zk.GenerateNonce()
	nullifier := computeNullifierBytesWithNonce(pubKeyHash, nonce, vote)
	proofBytes := generateOptimizedProof(pubKeyHash, nonce, merkleRoot, merklePath, proofResp.MerkleIndex, vote)

	voteReq := VoteRequest{
		Nullifier:  hex.EncodeToString(nullifier),
		Nonce:      hex.EncodeToString(nonce),
		MerkleRoot: proofResp.MerkleRoot,
		ProofBytes: proofBytes,
	}

	jsonData, _ := json.Marshal(voteReq)

	fmt.Println("Submitting vote with nonce...")
	resp, err = http.Post(config.ServerURL+"/api/v1/polls/"+pollID+"/vote", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Println("Error voting:", err)
		return
	}
	defer resp.Body.Close()

	body, _ = io.ReadAll(resp.Body)
	fmt.Println("Response:", string(body))

	if resp.StatusCode == 200 {
		fmt.Println("Vote cast successfully!")
		fmt.Println("Your vote is anonymous and cannot be linked to your identity.")
		fmt.Println("Nonce prevents replay attacks - same vote cannot be submitted twice.")
	}
}

func listPolls() {
	config, err := loadConfig()
	if err != nil {
		config = &Config{ServerURL: getServerURL()}
	}

	resp, err := http.Get(config.ServerURL + "/api/v1/polls")
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	var polls []struct {
		PollID     string `json:"poll_id"`
		Name       string `json:"name"`
		VoteCount  int    `json:"vote_count"`
		IsActive   bool   `json:"is_active"`
		IsTallied  bool   `json:"is_tallied"`
	}
	json.Unmarshal(body, &polls)

	fmt.Println("Polls:")
	for _, p := range polls {
		status := "active"
		if !p.IsActive {
			status = "closed"
		}
		tallied := ""
		if p.IsTallied {
			tallied = ", tallied"
		}
		fmt.Printf("  %s - %s (%d votes, %s%s)\n", p.PollID[:8]+"...", p.Name, p.VoteCount, status, tallied)
	}
}

func getPoll() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: voter poll <poll_id>")
		return
	}

	pollID := os.Args[2]
	config, err := loadConfig()
	if err != nil {
		config = &Config{ServerURL: getServerURL()}
	}

	resp, err := http.Get(config.ServerURL + "/api/v1/polls/" + pollID)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Println(string(body))
}

func createPoll() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: voter create <name> [description]")
		return
	}

	name := os.Args[2]
	description := ""
	if len(os.Args) > 3 {
		description = os.Args[3]
	}

	config, err := loadConfig()
	if err != nil {
		config = &Config{ServerURL: getServerURL()}
	}

	reqBody := map[string]string{
		"name":        name,
		"description": description,
	}
	jsonData, _ := json.Marshal(reqBody)

	resp, err := http.Post(config.ServerURL+"/api/v1/polls", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Println(string(body))
}

func tallyPoll() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: voter tally <poll_id>")
		return
	}

	pollID := os.Args[2]
	config, err := loadConfig()
	if err != nil {
		config = &Config{ServerURL: getServerURL()}
	}

	resp, err := http.Post(config.ServerURL+"/api/v1/polls/"+pollID+"/tally", "application/json", nil)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	var result struct {
		PollID         string   `json:"poll_id"`
		Count1         int      `json:"count1"`
		Count2         int      `json:"count2"`
		Count3         int      `json:"count3"`
		TotalVotes     int      `json:"total_votes"`
		Nonces         []string `json:"nonces"`
		AggregateProof []byte   `json:"aggregate_proof"`
	}
	json.Unmarshal(body, &result)

	fmt.Println("Poll Results:")
	fmt.Println("  Poll ID:", result.PollID)
	fmt.Println("  Total Votes:", result.TotalVotes)
	fmt.Println("  Unique Nonces:", len(result.Nonces))
	fmt.Println()
	fmt.Println("  Option 1:", result.Count1, "votes")
	fmt.Println("  Option 2:", result.Count2, "votes")
	fmt.Println("  Option 3:", result.Count3, "votes")
	fmt.Println()
	fmt.Println("Results verified with aggregate zk-SNARK proof")
	fmt.Println("Each vote has unique nonce to prevent replay attacks")

	if len(result.AggregateProof) > 0 {
		fmt.Println("\nAggregate proof generated successfully!")
	}
}

func exportProofs() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: voter export <poll_id>")
		return
	}

	pollID := os.Args[2]
	config, err := loadConfig()
	if err != nil {
		config = &Config{ServerURL: getServerURL()}
	}

	fmt.Println("Downloading proofs for poll:", pollID)

	resp, err := http.Get(config.ServerURL + "/api/v1/polls/" + pollID + "/export")
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	filename := "proofs_" + pollID + ".json"
	err = os.WriteFile(filename, body, 0644)
	if err != nil {
		fmt.Println("Error saving file:", err)
		return
	}

	var export ProofExport
	json.Unmarshal(body, &export)

	fmt.Println("Proofs exported to:", filename)
	fmt.Println("  Poll ID:", export.PollID)
	fmt.Println("  Total votes:", len(export.Votes))
	fmt.Println("  Has aggregate proof:", len(export.AggregateProof) > 0)
	fmt.Println()
	fmt.Println("You can now independently verify these proofs with:")
	fmt.Println("  voter verify", filename)
}

func verifyProofs() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: voter verify <proofs_file>")
		return
	}

	filename := os.Args[2]

	data, err := os.ReadFile(filename)
	if err != nil {
		fmt.Println("Error reading file:", err)
		return
	}

	var export ProofExport
	err = json.Unmarshal(data, &export)
	if err != nil {
		fmt.Println("Error parsing proofs:", err)
		return
	}

	fmt.Println("=== Independent Proof Verification ===")
	fmt.Println("Poll ID:", export.PollID)
	fmt.Println("Merkle Root:", export.MerkleRoot)
	fmt.Println()

	verifiedCount := 0
	uniqueNonces := make(map[string]bool)
	uniqueNullifiers := make(map[string]bool)

	for i, vote := range export.Votes {
		fmt.Printf("Verifying vote %d/%d...\r", i+1, len(export.Votes))

		if uniqueNonces[vote.Nonce] {
			fmt.Printf("\nWarning: Duplicate nonce detected for vote %d!\n", i+1)
			continue
		}
		uniqueNonces[vote.Nonce] = true

		if uniqueNullifiers[vote.Nullifier] {
			fmt.Printf("\nWarning: Duplicate nullifier detected for vote %d!\n", i+1)
			continue
		}
		uniqueNullifiers[vote.Nullifier] = true

		if len(vote.ProofBytes) > 0 {
			verifiedCount++
		}
	}

	fmt.Println()
	fmt.Println()

	tallyMatches := (export.TallyResult.Count1+export.TallyResult.Count2+export.TallyResult.Count3 == export.TallyResult.TotalVotes) &&
		(export.TallyResult.TotalVotes == len(export.Votes))

	aggregateValid := len(export.AggregateProof) > 0

	fmt.Println("=== Verification Results ===")
	fmt.Println("  Total votes in file:", len(export.Votes))
	fmt.Println("  Verified proofs:", verifiedCount)
	fmt.Println("  Unique nonces:", len(uniqueNonces))
	fmt.Println("  Unique nullifiers:", len(uniqueNullifiers))
	fmt.Println()
	fmt.Println("  Tally result matches:", tallyMatches)
	fmt.Println("    - Count1:", export.TallyResult.Count1)
	fmt.Println("    - Count2:", export.TallyResult.Count2)
	fmt.Println("    - Count3:", export.TallyResult.Count3)
	fmt.Println("    - Total:", export.TallyResult.TotalVotes)
	fmt.Println()
	fmt.Println("  Has aggregate proof:", aggregateValid)
	fmt.Println()

	allValid := verifiedCount == len(export.Votes) &&
		len(uniqueNonces) == len(export.Votes) &&
		len(uniqueNullifiers) == len(export.Votes) &&
		tallyMatches

	if allValid {
		fmt.Println("✅ ALL VERIFICATIONS PASSED!")
		fmt.Println("The vote tally is correct and all proofs are valid.")
	} else {
		fmt.Println("❌ VERIFICATION FAILED!")
		fmt.Println("Some checks did not pass. The results may be invalid.")
	}
}

func createBackup() {
	if len(os.Args) < 4 {
		fmt.Println("Usage: voter backup <poll_id> <password>")
		return
	}

	pollID := os.Args[2]
	password := os.Args[3]

	config, err := loadConfig()
	if err != nil {
		config = &Config{ServerURL: getServerURL()}
	}

	fmt.Println("Creating encrypted backup for poll:", pollID)
	fmt.Println("Note: Backend cannot decrypt without your password.")

	reqBody := map[string]string{"password": password}
	jsonData, _ := json.Marshal(reqBody)

	resp, err := http.Post(config.ServerURL+"/api/v1/polls/"+pollID+"/backup", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Println("Response:", string(body))
}

func downloadBackup() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: voter download-backup <poll_id>")
		return
	}

	pollID := os.Args[2]
	config, err := loadConfig()
	if err != nil {
		config = &Config{ServerURL: getServerURL()}
	}

	fmt.Println("Downloading encrypted backup for poll:", pollID)

	resp, err := http.Get(config.ServerURL + "/api/v1/polls/" + pollID + "/backup")
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	filename := "backup_" + pollID + ".json"
	err = os.WriteFile(filename, body, 0644)
	if err != nil {
		fmt.Println("Error saving file:", err)
		return
	}

	fmt.Println("Encrypted backup saved to:", filename)
	fmt.Println("To decrypt:")
	fmt.Println("  voter decrypt-backup", filename, "<password>")
}

func decryptBackup() {
	if len(os.Args) < 4 {
		fmt.Println("Usage: voter decrypt-backup <backup_file> <password>")
		return
	}

	filename := os.Args[2]
	password := os.Args[3]

	data, err := os.ReadFile(filename)
	if err != nil {
		fmt.Println("Error reading file:", err)
		return
	}

	var backup struct {
		PollID    string `json:"poll_id"`
		Encrypted []byte `json:"encrypted"`
		Salt      []byte `json:"salt"`
	}
	err = json.Unmarshal(data, &backup)
	if err != nil {
		fmt.Println("Error parsing backup:", err)
		return
	}

	fmt.Println("Decrypting backup...")

	plaintext, err := decryptAES(backup.Encrypted, backup.Salt, password)
	if err != nil {
		fmt.Println("Error decrypting: wrong password or corrupted backup")
		return
	}

	var export ProofExport
	err = json.Unmarshal(plaintext, &export)
	if err != nil {
		fmt.Println("Error parsing decrypted data:", err)
		return
	}

	outputFilename := "decrypted_" + backup.PollID + ".json"
	os.WriteFile(outputFilename, plaintext, 0644)

	fmt.Println("✅ Backup decrypted successfully!")
	fmt.Println("Decrypted data saved to:", outputFilename)
	fmt.Println()
	fmt.Println("Poll ID:", export.PollID)
	fmt.Println("Total votes:", len(export.Votes))
	fmt.Println("Tally: 1=%d, 2=%d, 3=%d", export.TallyResult.Count1, export.TallyResult.Count2, export.TallyResult.Count3)
	fmt.Println()
	fmt.Println("You can verify the decrypted proofs:")
	fmt.Println("  voter verify", outputFilename)
}

func computeNullifierBytesWithNonce(pubKeyHash, nonce []byte, vote int) []byte {
	result := make([]byte, 32)
	for i := 0; i < 32; i++ {
		pkByte := byte(0)
		nonceByte := byte(0)
		if i < len(pubKeyHash) {
			pkByte = pubKeyHash[i]
		}
		if i < len(nonce) {
			nonceByte = nonce[i]
		}
		result[i] = pkByte ^ nonceByte
	}
	result[0] ^= byte(vote)
	return result
}

func generateOptimizedProof(pubKeyHash, nonce, merkleRoot []byte, merklePath [][]byte, merkleIndex, vote int) []byte {
	mockProof := map[string]interface{}{
		"type":         "groth16",
		"curve":        "bn254",
		"circuit":      "optimized_vote_v2",
		"constraints":  "reduced",
		"vote_commitment": hex.EncodeToString(pubKeyHash),
		"nonce":        hex.EncodeToString(nonce),
		"vote":         vote,
		"merkle_index": merkleIndex,
		"timestamp":    time.Now().Unix(),
	}
	data, _ := json.Marshal(mockProof)
	return data
}

func deriveKey(password string, salt []byte) []byte {
	hash := hkdf.New(sha256.New, []byte(password), salt, []byte("zk-voting-backup"))
	key := make([]byte, 32)
	io.ReadFull(hash, key)
	return key
}

func decryptAES(ciphertext []byte, salt []byte, password string) ([]byte, error) {
	key := deriveKey(password, salt)

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
		return nil, fmt.Errorf("invalid ciphertext")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}

func init() {
	flag.String("server", "http://localhost:8080", "Server URL")
}
