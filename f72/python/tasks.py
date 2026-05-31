import time
import random
from celery import Celery, group, chord

app = Celery('tasks', broker='redis://localhost:6379/0', backend='redis://localhost:6379/0')

app.conf.update(
    result_expires=3600,
    task_track_started=True,
    task_send_sent_event=True,
)


@app.task(bind=True)
def process_data(self, data_id):
    self.update_state(state='STARTED', meta={'progress': 0, 'data_id': data_id})
    time.sleep(random.uniform(0.5, 2))
    self.update_state(state='STARTED', meta={'progress': 50, 'data_id': data_id})
    time.sleep(random.uniform(0.5, 2))
    result = {'data_id': data_id, 'value': random.randint(100, 1000), 'processed': True}
    return result


@app.task(bind=True)
def analyze_result(self, results):
    self.update_state(state='STARTED', meta={'progress': 0})
    time.sleep(random.uniform(0.3, 1))
    total = sum(r['value'] for r in results if isinstance(r, dict))
    avg = total / len(results) if results else 0
    self.update_state(state='STARTED', meta={'progress': 100})
    return {'total': total, 'average': avg, 'count': len(results)}


@app.task
def error_task():
    raise ValueError("Something went wrong!")


def create_workflow():
    tasks = [process_data.s(i) for i in range(1, 6)]
    workflow = chord(tasks)(analyze_result.s())
    return workflow


if __name__ == '__main__':
    print("Starting workflow...")
    result = create_workflow()
    print(f"Workflow ID: {result.id}")
    print("To add more tasks, run:")
    print("  python -c \"from tasks import process_data; process_data.delay(100)\"")
