package discovery

import (
	"context"
	"fmt"
	"sync"
	"time"

	clientv3 "go.etcd.io/etcd/client/v3"
)

type ServiceDiscovery struct {
	client *clientv3.Client
	leaseID clientv3.LeaseID
	leaseTTL int64
	mu sync.RWMutex
	services map[string][]string
	watchCancel context.CancelFunc
	watchStop chan struct{}
}

type ServiceInfo struct {
	ID   string
	Addr string
	Type string
}

func NewServiceDiscovery(etcdEndpoints []string, ttl int64) (*ServiceDiscovery, error) {
	client, err := clientv3.New(clientv3.Config{
		Endpoints:   etcdEndpoints,
		DialTimeout: 5 * time.Second,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create etcd client: %v", err)
	}
	return &ServiceDiscovery{
		client:     client,
		leaseTTL:   ttl,
		services:   make(map[string][]string),
		watchStop: make(chan struct{}),
	}, nil
}

func (sd *ServiceDiscovery) RegisterService(ctx context.Context, info *ServiceInfo) error {
	grant, err := sd.client.Grant(ctx, sd.leaseTTL)
	if err != nil {
		return fmt.Errorf("failed to create lease: %v", err)
	}
	sd.leaseID = grant.ID
	key := fmt.Sprintf("/pagerank/services/%s/%s", info.Type, info.ID)
	value := info.Addr
	_, err = sd.client.Put(ctx, key, value, clientv3.WithLease(sd.leaseID))
	if err != nil {
		return fmt.Errorf("failed to register service: %v", err)
	}
	fmt.Printf("[Discovery] Registered service: %s at %s\n", key, value)
	return sd.keepAlive(ctx)
}

func (sd *ServiceDiscovery) keepAlive(ctx context.Context) error {
	ch, err := sd.client.KeepAlive(ctx, sd.leaseID)
	if err != nil {
		return fmt.Errorf("failed to start keepalive: %v", err)
	}
	go func() {
		for {
			select {
			case _, ok := <-ch:
				if !ok {
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()
	return nil
}

func (sd *ServiceDiscovery) DiscoverServices(ctx context.Context, serviceType string) ([]string, error) {
	prefix := fmt.Sprintf("/pagerank/services/%s/", serviceType)
	resp, err := sd.client.Get(ctx, prefix, clientv3.WithPrefix())
	if err != nil {
		return nil, fmt.Errorf("failed to discover services: %v", err)
	}
	sd.mu.Lock()
	defer sd.mu.Unlock()
	sd.services[serviceType] = make([]string, 0)
	for _, kv := range resp.Kvs {
		sd.services[serviceType] = append(sd.services[serviceType], string(kv.Value))
	}
	return sd.services[serviceType], nil
}

func (sd *ServiceDiscovery) WatchServices(ctx context.Context, serviceType string) {
	prefix := fmt.Sprintf("/pagerank/services/%s/", serviceType)
	rch := sd.client.Watch(ctx, prefix, clientv3.WithPrefix())
	go func() {
		for {
			select {
			case <-sd.watchStop:
				return
			case wresp := <-rch:
				for _, ev := range wresp.Events {
					switch ev.Type {
					case clientv3.EventTypePut:
						fmt.Printf("[Discovery] Service registered: %s = %s\n", ev.Kv.Key, ev.Kv.Value)
					case clientv3.EventTypeDelete:
						fmt.Printf("[Discovery] Service deleted: %s\n", ev.Kv.Key)
					}
				}
				sd.DiscoverServices(ctx, serviceType)
			}
		}
	}()
}

func (sd *ServiceDiscovery) DeregisterService(ctx context.Context, info *ServiceInfo) error {
	key := fmt.Sprintf("/pagerank/services/%s/%s", info.Type, info.ID)
	_, err := sd.client.Delete(ctx, key)
	if err != nil {
		return fmt.Errorf("failed to deregister service: %v", err)
	}
	fmt.Printf("[Discovery] Deregistered service: %s\n", key)
	return nil
}

func (sd *ServiceDiscovery) GetServices(serviceType string) []string {
	sd.mu.RLock()
	defer sd.mu.RUnlock()
	return sd.services[serviceType]
}

func (sd *ServiceDiscovery) Close() error {
	if sd.watchStop != nil {
		close(sd.watchStop)
	}
	if sd.watchCancel != nil {
		sd.watchCancel()
	}
	return sd.client.Close()
}
