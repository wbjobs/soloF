package main

import (
	"log"
	"net/http"
	"os"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/joho/godotenv"
	"github.com/rs/cors"

	"graphql-server/graph"
	"graphql-server/graph/generated"
)

func main() {
	_ = godotenv.Load()

	neo4jURI := getEnv("NEO4J_URI", "bolt://localhost:7687")
	neo4jUser := getEnv("NEO4J_USER", "neo4j")
	neo4jPassword := getEnv("NEO4J_PASSWORD", "password")
	vectorServiceURL := getEnv("VECTOR_SERVICE_URL", "http://localhost:8501")
	port := getEnv("PORT", "8080")

	store, err := graph.NewNeo4jStore(neo4jURI, neo4jUser, neo4jPassword)
	if err != nil {
		log.Fatalf("Failed to connect to Neo4j: %v", err)
	}
	defer store.Close()

	vectorService := graph.NewVectorService(vectorServiceURL)

	if healthy, err := vectorService.HealthCheck(); err == nil && healthy {
		log.Println("Vector service is healthy at", vectorServiceURL)
	} else {
		log.Printf("Warning: Vector service not available at %v", vectorServiceURL)
	}

	resolver := graph.NewResolver(store, vectorService)

	srv := handler.NewDefaultServer(generated.NewExecutableSchema(generated.Config{
		Resolvers: resolver,
	}))

	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	})

	mux := http.NewServeMux()
	mux.Handle("/", playground.Handler("GraphQL playground", "/query"))
	mux.Handle("/query", c.Handler(srv))

	log.Printf("GraphQL server running on port %s", port)
	log.Printf("Playground available at http://localhost:%s/", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
