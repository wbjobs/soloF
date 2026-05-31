FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /pagerank-master .

FROM alpine:3.19

RUN apk add --no-cache ca-certificates

COPY --from=builder /pagerank-master /usr/local/bin/pagerank-master

EXPOSE 50051 8080

ENTRYPOINT ["pagerank-master"]
CMD ["--grpc-port", "50051", "--http-port", "8080", "--workers", "3", "--etcd", "etcd:2379"]
