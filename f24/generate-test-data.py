#!/usr/bin/env python3
import random
import time
from kafka import KafkaProducer

ISBNS = [
    '978-7-111-54493-7', '978-7-111-54494-4', '978-7-111-54495-1',
    '978-7-111-54496-8', '978-7-111-54497-5', '978-7-111-54498-2',
    '978-7-111-54499-9', '978-7-111-54500-2', '978-7-111-54501-9',
    '978-7-111-54502-6'
]

BEHAVIORS = ['view', 'view', 'view', 'view', 'view', 'buy', 'buy', 'sell']

def generate_message():
    user_id = f'user{random.randint(1, 1000):04d}'
    isbn = random.choice(ISBNS)
    behavior = random.choice(BEHAVIORS)
    timestamp = int(time.time() * 1000)
    return f'{user_id},{isbn},{behavior},{timestamp}'

def main():
    print('开始生成测试数据...')
    print('按 Ctrl+C 停止')
    print('=' * 50)
    
    try:
        producer = KafkaProducer(bootstrap_servers='localhost:9092')
        count = 0
        while True:
            msg = generate_message()
            producer.send('book_behavior', msg.encode('utf-8'))
            count += 1
            if count % 10 == 0:
                print(f'已发送 {count} 条消息')
            time.sleep(0.1)
    except KeyboardInterrupt:
        print(f'\n共发送 {count} 条消息')
        print('停止生成数据')
    except Exception as e:
        print(f'错误: {e}')
    finally:
        if 'producer' in locals():
            producer.close()

if __name__ == '__main__':
    main()
