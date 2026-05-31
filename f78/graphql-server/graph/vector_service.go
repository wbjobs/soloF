package graph

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type VectorService struct {
	baseURL    string
	httpClient *http.Client
}

func NewVectorService(baseURL string) *VectorService {
	return &VectorService{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type EmbedRequest struct {
	Texts []string `json:"texts"`
}

type EmbedResponse struct {
	Embeddings [][]float64 `json:"embeddings"`
	Model      string    `json:"model"`
	Dimension  int       `json:"dimension"`
}

type SimilarityRequest struct {
	Query   string   `json:"query"`
	Texts   []string `json:"texts"`
	TopK    int      `json:"top_k"`
}

type SimilarityResult struct {
	Text  string  `json:"text"`
	Score float64 `json:"score"`
	Index int     `json:"index"`
}

type SimilarityResponse struct {
	Results        []SimilarityResult `json:"results"`
	QueryEmbedding []float64          `json:"query_embedding"`
}

func (vs *VectorService) GetEmbedding(text string) ([]float64, error) {
	return vs.GetEmbeddings([]string{text})
}

func (vs *VectorService) GetEmbeddings(texts []string) ([]float64, error) {
	reqBody := EmbedRequest{Texts: texts}
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := vs.httpClient.Post(
		vs.baseURL+"/embed",
		"application/json",
		bytes.NewBuffer(jsonData),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to call embed endpoint: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embed endpoint returned status %d: %s", resp.StatusCode, string(body))
	}

	var result EmbedResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if len(result.Embeddings) > 0 {
		return result.Embeddings[0], nil
	}

	return nil, fmt.Errorf("no embeddings returned")
}

func (vs *VectorService) ComputeSimilarity(query string, texts []string, topK int) (*SimilarityResponse, error) {
	reqBody := SimilarityRequest{
		Query: query,
		Texts: texts,
		TopK:  topK,
	}
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := vs.httpClient.Post(
		vs.baseURL+"/similarity",
		"application/json",
		bytes.NewBuffer(jsonData),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to call similarity endpoint: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("similarity endpoint returned status %d: %s", resp.StatusCode, string(body))
	}

	var result SimilarityResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

func (vs *VectorService) HealthCheck() (bool, error) {
	resp, err := vs.httpClient.Get(vs.baseURL + "/health")
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK, nil
}
