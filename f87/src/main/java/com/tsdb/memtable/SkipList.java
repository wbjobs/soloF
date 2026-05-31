package com.tsdb.memtable;

import java.util.*;
import java.util.concurrent.ThreadLocalRandom;

public class SkipList<K extends Comparable<K>, V> {
    private static final int MAX_LEVEL = 16;
    private static final double P = 0.5;

    private final Node<K, V> head;
    private int level;
    private int size;

    public SkipList() {
        this.head = new Node<>(null, null, MAX_LEVEL);
        this.level = 0;
        this.size = 0;
    }

    public void put(K key, V value) {
        Node<K, V>[] update = new Node[MAX_LEVEL];
        Node<K, V> current = head;

        for (int i = level; i >= 0; i--) {
            while (current.next[i] != null && current.next[i].key.compareTo(key) < 0) {
                current = current.next[i];
            }
            update[i] = current;
        }

        current = current.next[0];

        if (current != null && current.key.compareTo(key) == 0) {
            current.value = value;
            return;
        }

        int newLevel = randomLevel();

        if (newLevel > level) {
            for (int i = level + 1; i <= newLevel; i++) {
                update[i] = head;
            }
            level = newLevel;
        }

        Node<K, V> newNode = new Node<>(key, value, newLevel + 1);
        for (int i = 0; i <= newLevel; i++) {
            newNode.next[i] = update[i].next[i];
            update[i].next[i] = newNode;
        }

        size++;
    }

    public V get(K key) {
        Node<K, V> current = head;
        for (int i = level; i >= 0; i--) {
            while (current.next[i] != null && current.next[i].key.compareTo(key) < 0) {
                current = current.next[i];
            }
        }
        current = current.next[0];
        if (current != null && current.key.compareTo(key) == 0) {
            return current.value;
        }
        return null;
    }

    public boolean containsKey(K key) {
        return get(key) != null;
    }

    public List<V> range(K start, K end) {
        List<V> result = new ArrayList<>();
        Node<K, V> current = head;

        for (int i = level; i >= 0; i--) {
            while (current.next[i] != null && current.next[i].key.compareTo(start) < 0) {
                current = current.next[i];
            }
        }

        current = current.next[0];
        while (current != null && current.key.compareTo(end) <= 0) {
            result.add(current.value);
            current = current.next[0];
        }

        return result;
    }

    public Iterator<V> iterator() {
        return new SkipListIterator();
    }

    private int randomLevel() {
        int lvl = 0;
        while (ThreadLocalRandom.current().nextDouble() < P && lvl < MAX_LEVEL - 1) {
            lvl++;
        }
        return lvl;
    }

    public int size() {
        return size;
    }

    public boolean isEmpty() {
        return size == 0;
    }

    private static class Node<K extends Comparable<K>, V> {
        K key;
        V value;
        Node<K, V>[] next;

        @SuppressWarnings("unchecked")
        Node(K key, V value, int level) {
            this.key = key;
            this.value = value;
            this.next = new Node[level];
        }
    }

    private class SkipListIterator implements Iterator<V> {
        private Node<K, V> current;

        SkipListIterator() {
            this.current = head.next[0];
        }

        @Override
        public boolean hasNext() {
            return current != null;
        }

        @Override
        public V next() {
            if (!hasNext()) {
                throw new NoSuchElementException();
            }
            V value = current.value;
            current = current.next[0];
            return value;
        }
    }
}
