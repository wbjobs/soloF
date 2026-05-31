import json
import time
import hashlib
import binascii
import os
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad
import paho.mqtt.client as mqtt

DEVICE_ID = "device_001"
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
CHUNK_SIZE = 8 * 1024

current_firmware_id = None
expected_size = 0
expected_checksum = ""
aes_key = None
received_offset = 0
temp_file_path = None
temp_file = None

def decrypt_aes(ciphertext, key):
    iv = ciphertext[:16]
    cipher = AES.new(key, AES.MODE_CBC, iv)
    plaintext = unpad(cipher.decrypt(ciphertext[16:]), AES.block_size)
    return plaintext

def on_connect(client, userdata, flags, rc):
    print(f"Connected with result code {rc}")
    client.subscribe(f"device/{DEVICE_ID}/upgrade/cmd")
    client.subscribe(f"device/{DEVICE_ID}/upgrade/data")

def calculate_file_checksum(file_path):
    md5_hash = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            md5_hash.update(chunk)
    return md5_hash.hexdigest()

def cleanup_temp_file():
    global temp_file, temp_file_path
    if temp_file:
        try:
            temp_file.close()
        except:
            pass
        temp_file = None
    if temp_file_path and os.path.exists(temp_file_path):
        try:
            os.remove(temp_file_path)
        except:
            pass
        temp_file_path = None

def on_message(client, userdata, msg):
    global current_firmware_id, expected_size, expected_checksum
    global aes_key, received_offset, temp_file, temp_file_path
    
    topic = msg.topic
    payload = json.loads(msg.payload.decode())
    
    if topic.endswith("/upgrade/cmd"):
        print(f"Received upgrade command: {payload}")
        cleanup_temp_file()
        
        current_firmware_id = payload["firmware_id"]
        expected_size = payload["total_size"]
        expected_checksum = payload["checksum"]
        aes_key = binascii.unhexlify(payload["aes_key"])
        
        received_offset = 0
        temp_file_path = f"firmware_{current_firmware_id}.tmp"
        
        os.makedirs(os.path.dirname(os.path.abspath(temp_file_path)) or ".", exist_ok=True)
        temp_file = open(temp_file_path, "w+b")
        
        print(f"Starting upgrade for firmware: {current_firmware_id}")
        print(f"Expected size: {expected_size} bytes")
        print(f"Temp file: {temp_file_path}")
        
    elif topic.endswith("/upgrade/data"):
        fw_id = payload["firmware_id"]
        offset = payload["offset"]
        size = payload["size"]
        data_hex = payload["data"]
        
        if fw_id != current_firmware_id or temp_file is None:
            print(f"Ignoring data for wrong firmware: {fw_id}")
            return
            
        encrypted_data = binascii.unhexlify(data_hex)
        decrypted_data = decrypt_aes(encrypted_data, aes_key)
        
        if offset != received_offset:
            print(f"Resuming from offset: {offset}")
            received_offset = offset
            
        temp_file.seek(offset)
        temp_file.write(decrypted_data)
        temp_file.flush()
        os.fsync(temp_file.fileno())
        
        received_offset += len(decrypted_data)
        
        progress = (received_offset / expected_size) * 100
        print(f"Received chunk at offset {offset}, progress: {progress:.1f}%")
        
        ack_payload = json.dumps({
            "firmware_id": current_firmware_id,
            "received": received_offset,
            "complete": received_offset >= expected_size
        }).encode()
        
        client.publish(f"device/{DEVICE_ID}/upgrade/ack", ack_payload, qos=1)
        
        if received_offset >= expected_size:
            temp_file.seek(0)
            temp_file.flush()
            os.fsync(temp_file.fileno())
            
            actual_checksum = calculate_file_checksum(temp_file_path)
            print(f"\nFirmware download complete!")
            print(f"Expected checksum: {expected_checksum}")
            print(f"Actual checksum:   {actual_checksum}")
            
            if actual_checksum == expected_checksum:
                print("Checksum verification PASSED!")
                save_path = f"firmware_{current_firmware_id}.bin"
                temp_file.close()
                if os.path.exists(save_path):
                    os.remove(save_path)
                os.rename(temp_file_path, save_path)
                print(f"Firmware saved to: {save_path}")
            else:
                print("Checksum verification FAILED!")
                cleanup_temp_file()
                
            current_firmware_id = None
            temp_file = None
            temp_file_path = None

def send_heartbeat(client):
    payload = json.dumps({"ip": "192.168.1.100"}).encode()
    client.publish(f"device/{DEVICE_ID}/heartbeat", payload, qos=1)

def send_version(client):
    payload = json.dumps({"version": "v1.0.0"}).encode()
    client.publish(f"device/{DEVICE_ID}/version", payload, qos=1)

def main():
    client = mqtt.Client(client_id=DEVICE_ID)
    client.on_connect = on_connect
    client.on_message = on_message
    
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()
    
    print(f"Device {DEVICE_ID} started")
    
    try:
        while True:
            send_heartbeat(client)
            send_version(client)
            time.sleep(5)
    except KeyboardInterrupt:
        print("\nDevice shutting down...")
        cleanup_temp_file()
        client.loop_stop()
        client.disconnect()

if __name__ == "__main__":
    main()
