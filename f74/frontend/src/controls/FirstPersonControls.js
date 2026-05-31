import * as THREE from 'three';

export class FirstPersonControls {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        
        this.moveSpeed = 50.0;
        this.lookSpeed = 0.002;
        this.verticalVelocity = 0.0;
        this.gravity = 0.0;
        this.jumpStrength = 10.0;
        
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
        this.moveUp = false;
        this.moveDown = false;
        this.canJump = false;
        
        this.pitch = 0;
        this.yaw = 0;
        
        this.isLocked = false;
        this.enabled = false;
        
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        
        this.camera.rotation.order = 'YXZ';
        
        this.bindEvents();
    }

    bindEvents() {
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onClick = this.onClick.bind(this);
        this.onPointerLockChange = this.onPointerLockChange.bind(this);
        
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
        document.addEventListener('mousemove', this.onMouseMove);
        this.domElement.addEventListener('click', this.onClick);
        document.addEventListener('pointerlockchange', this.onPointerLockChange);
    }

    unbindEvents() {
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        document.removeEventListener('mousemove', this.onMouseMove);
        this.domElement.removeEventListener('click', this.onClick);
        document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    }

    onClick() {
        if (!this.enabled) return;
        this.domElement.requestPointerLock();
    }

    onPointerLockChange() {
        this.isLocked = document.pointerLockElement === this.domElement;
    }

    onKeyDown(event) {
        if (!this.enabled) return;
        
        switch (event.code) {
            case 'KeyW':
                this.moveForward = true;
                break;
            case 'KeyS':
                this.moveBackward = true;
                break;
            case 'KeyA':
                this.moveLeft = true;
                break;
            case 'KeyD':
                this.moveRight = true;
                break;
            case 'Space':
                this.moveUp = true;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.moveDown = true;
                break;
        }
    }

    onKeyUp(event) {
        switch (event.code) {
            case 'KeyW':
                this.moveForward = false;
                break;
            case 'KeyS':
                this.moveBackward = false;
                break;
            case 'KeyA':
                this.moveLeft = false;
                break;
            case 'KeyD':
                this.moveRight = false;
                break;
            case 'Space':
                this.moveUp = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.moveDown = false;
                break;
        }
    }

    onMouseMove(event) {
        if (!this.enabled || !this.isLocked) return;
        
        const movementX = event.movementX || 0;
        const movementY = event.movementY || 0;
        
        this.yaw -= movementX * this.lookSpeed;
        this.pitch -= movementY * this.lookSpeed;
        
        this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
        
        this.camera.rotation.x = this.pitch;
        this.camera.rotation.y = this.yaw;
    }

    update(deltaTime) {
        if (!this.enabled) return;
        
        const speed = this.moveSpeed * deltaTime;
        
        this.velocity.x -= this.velocity.x * 10.0 * deltaTime;
        this.velocity.z -= this.velocity.z * 10.0 * deltaTime;
        this.velocity.y -= this.velocity.y * 10.0 * deltaTime;
        
        this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
        this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
        this.direction.y = Number(this.moveUp) - Number(this.moveDown);
        this.direction.normalize();
        
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        forward.y = 0;
        forward.normalize();
        
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        right.y = 0;
        right.normalize();
        
        const up = new THREE.Vector3(0, 1, 0);
        
        if (this.direction.z !== 0) {
            this.velocity.addScaledVector(forward, this.direction.z * speed);
        }
        if (this.direction.x !== 0) {
            this.velocity.addScaledVector(right, this.direction.x * speed);
        }
        if (this.direction.y !== 0) {
            this.velocity.addScaledVector(up, this.direction.y * speed);
        }
        
        this.camera.position.addScaledVector(this.velocity, deltaTime * 10);
    }

    getPosition() {
        return this.camera.position.clone();
    }

    setPosition(x, y, z) {
        this.camera.position.set(x, y, z);
    }

    setRotation(yaw, pitch) {
        this.yaw = yaw;
        this.pitch = pitch;
        this.camera.rotation.x = this.pitch;
        this.camera.rotation.y = this.yaw;
    }

    dispose() {
        this.unbindEvents();
    }
}
