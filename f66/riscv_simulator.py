class RiscvSimulator:
    REGISTER_NAMES = [
        'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
        's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
        'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
        's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'
    ]

    def __init__(self, memory_size=1024 * 1024):
        self.pc = 0
        self.registers = [0] * 32
        self.memory = bytearray(memory_size)
        self.breakpoints = set()
        self.running = False
        self.memory_size = memory_size
        self.call_stack = []

    def reset(self):
        self.pc = 0
        self.registers = [0] * 32
        self.running = False
        self.call_stack = []

    def get_call_stack(self):
        return list(self.call_stack)

    def load_binary(self, binary_data, start_address=0):
        for i, byte in enumerate(binary_data):
            if start_address + i < self.memory_size:
                self.memory[start_address + i] = byte

    def read_register(self, name):
        if name in self.REGISTER_NAMES:
            idx = self.REGISTER_NAMES.index(name)
            return self.registers[idx]
        elif name.startswith('x') and name[1:].isdigit():
            idx = int(name[1:])
            if 0 <= idx < 32:
                return self.registers[idx]
        raise ValueError(f"Unknown register: {name}")

    def write_register(self, name, value):
        if name in self.REGISTER_NAMES:
            idx = self.REGISTER_NAMES.index(name)
        elif name.startswith('x') and name[1:].isdigit():
            idx = int(name[1:])
        else:
            raise ValueError(f"Unknown register: {name}")
        if idx != 0:
            self.registers[idx] = value & 0xFFFFFFFF

    def read_memory(self, address, size=4):
        address = address & 0xFFFFFFFF
        if address + size > self.memory_size:
            raise ValueError(f"Memory access out of bounds: {address}")
        value = 0
        for i in range(size):
            value |= self.memory[address + i] << (i * 8)
        return value

    def write_memory(self, address, value, size=4):
        address = address & 0xFFFFFFFF
        if address + size > self.memory_size:
            raise ValueError(f"Memory access out of bounds: {address}")
        for i in range(size):
            self.memory[address + i] = (value >> (i * 8)) & 0xFF

    def _sign_extend(self, value, bits):
        sign_bit = 1 << (bits - 1)
        if value & sign_bit:
            value = value - (1 << bits)
        return value

    def _fetch(self):
        instruction = self.read_memory(self.pc, 4)
        self.pc += 4
        return instruction

    def _decode(self, instruction):
        opcode = instruction & 0x7F
        rd = (instruction >> 7) & 0x1F
        funct3 = (instruction >> 12) & 0x7
        rs1 = (instruction >> 15) & 0x1F
        rs2 = (instruction >> 20) & 0x1F
        funct7 = (instruction >> 25) & 0x7F

        imm_i = self._sign_extend((instruction >> 20) & 0xFFF, 12)
        imm_s = self._sign_extend(((instruction >> 7) & 0x1F) | ((instruction >> 25) << 5), 12)
        imm_b = self._sign_extend(
            ((instruction >> 8) & 0xF) << 1 |
            ((instruction >> 25) & 0x3F) << 5 |
            ((instruction >> 7) & 0x1) << 11 |
            ((instruction >> 31) << 12),
            13
        )
        imm_u = (instruction >> 12) << 12
        imm_j = self._sign_extend(
            ((instruction >> 21) & 0x3FF) << 1 |
            ((instruction >> 20) & 0x1) << 11 |
            ((instruction >> 12) & 0xFF) << 12 |
            ((instruction >> 31) << 20),
            21
        )

        return {
            'opcode': opcode,
            'rd': rd,
            'funct3': funct3,
            'rs1': rs1,
            'rs2': rs2,
            'funct7': funct7,
            'imm_i': imm_i,
            'imm_s': imm_s,
            'imm_b': imm_b,
            'imm_u': imm_u,
            'imm_j': imm_j
        }

    def _execute(self, dec):
        opcode = dec['opcode']
        rd = dec['rd']
        funct3 = dec['funct3']
        rs1 = dec['rs1']
        rs2 = dec['rs2']
        funct7 = dec['funct7']

        if opcode == 0x37:
            self.registers[rd] = dec['imm_u']
        elif opcode == 0x17:
            self.registers[rd] = self.pc + dec['imm_u'] - 4
        elif opcode == 0x6F:
            self.registers[rd] = self.pc
            target_pc = (self.pc - 4) + dec['imm_j']
            if rd == 1:
                self.call_stack.append({
                    'return_addr': self.pc,
                    'func_addr': target_pc,
                    'caller_pc': self.pc - 4
                })
            self.pc = target_pc
        elif opcode == 0x67:
            self.registers[rd] = self.pc
            target = (self.registers[rs1] + dec['imm_i']) & ~1
            if rd == 1:
                self.call_stack.append({
                    'return_addr': self.pc,
                    'func_addr': target,
                    'caller_pc': self.pc - 4
                })
            elif rd == 0 and rs1 == 1 and dec['imm_i'] == 0:
                if self.call_stack:
                    self.call_stack.pop()
            self.pc = target
        elif opcode == 0x63:
            src1 = self.registers[rs1]
            src2 = self.registers[rs2]
            taken = False
            if funct3 == 0x0:
                taken = src1 == src2
            elif funct3 == 0x1:
                taken = src1 != src2
            elif funct3 == 0x4:
                taken = src1 < src2
            elif funct3 == 0x5:
                taken = src1 >= src2
            elif funct3 == 0x6:
                taken = (src1 & 0xFFFFFFFF) < (src2 & 0xFFFFFFFF)
            elif funct3 == 0x7:
                taken = (src1 & 0xFFFFFFFF) >= (src2 & 0xFFFFFFFF)
            if taken:
                self.pc = (self.pc - 4) + dec['imm_b']
        elif opcode == 0x03:
            addr = self.registers[rs1] + dec['imm_i']
            if funct3 == 0x0:
                value = self._sign_extend(self.read_memory(addr, 1), 8)
            elif funct3 == 0x1:
                value = self._sign_extend(self.read_memory(addr, 2), 16)
            elif funct3 == 0x2:
                value = self.read_memory(addr, 4)
            elif funct3 == 0x4:
                value = self.read_memory(addr, 1)
            elif funct3 == 0x5:
                value = self.read_memory(addr, 2)
            else:
                raise ValueError(f"Unknown load funct3: {funct3}")
            self.registers[rd] = value & 0xFFFFFFFF
        elif opcode == 0x23:
            addr = self.registers[rs1] + dec['imm_s']
            value = self.registers[rs2]
            if funct3 == 0x0:
                self.write_memory(addr, value, 1)
            elif funct3 == 0x1:
                self.write_memory(addr, value, 2)
            elif funct3 == 0x2:
                self.write_memory(addr, value, 4)
            else:
                raise ValueError(f"Unknown store funct3: {funct3}")
        elif opcode == 0x13:
            src1 = self.registers[rs1]
            imm = dec['imm_i']
            if funct3 == 0x0:
                result = src1 + imm
            elif funct3 == 0x2:
                result = 1 if src1 < imm else 0
            elif funct3 == 0x3:
                result = 1 if (src1 & 0xFFFFFFFF) < (imm & 0xFFFFFFFF) else 0
            elif funct3 == 0x4:
                result = src1 ^ imm
            elif funct3 == 0x6:
                result = src1 | imm
            elif funct3 == 0x7:
                result = src1 & imm
            elif funct3 == 0x1:
                shamt = imm & 0x1F
                result = src1 << shamt
            elif funct3 == 0x5:
                shamt = imm & 0x1F
                if (imm >> 10) & 0x1:
                    result = self._sign_extend(src1, 32) >> shamt
                else:
                    result = (src1 & 0xFFFFFFFF) >> shamt
            else:
                raise ValueError(f"Unknown op-imm funct3: {funct3}")
            self.registers[rd] = result & 0xFFFFFFFF
        elif opcode == 0x33:
            src1 = self.registers[rs1]
            src2 = self.registers[rs2]
            if funct7 == 0x00:
                if funct3 == 0x0:
                    result = src1 + src2
                elif funct3 == 0x1:
                    result = src1 << (src2 & 0x1F)
                elif funct3 == 0x2:
                    result = 1 if src1 < src2 else 0
                elif funct3 == 0x3:
                    result = 1 if (src1 & 0xFFFFFFFF) < (src2 & 0xFFFFFFFF) else 0
                elif funct3 == 0x4:
                    result = src1 ^ src2
                elif funct3 == 0x5:
                    result = (src1 & 0xFFFFFFFF) >> (src2 & 0x1F)
                elif funct3 == 0x6:
                    result = src1 | src2
                elif funct3 == 0x7:
                    result = src1 & src2
                else:
                    raise ValueError(f"Unknown op funct3: {funct3}")
            elif funct7 == 0x20:
                if funct3 == 0x0:
                    result = src1 - src2
                elif funct3 == 0x5:
                    result = self._sign_extend(src1, 32) >> (src2 & 0x1F)
                else:
                    raise ValueError(f"Unknown op funct3 for funct7=0x20: {funct3}")
            else:
                raise ValueError(f"Unknown op funct7: {funct7}")
            self.registers[rd] = result & 0xFFFFFFFF
        elif opcode == 0x73:
            if funct3 == 0x0 and dec['imm_i'] == 0:
                self.running = False
                return 'ecall'
        else:
            raise ValueError(f"Unknown opcode: {opcode:#x} at PC {self.pc - 4:#x}")

        self.registers[0] = 0
        return None

    def step(self):
        instruction = self._fetch()
        dec = self._decode(instruction)
        result = self._execute(dec)
        return result

    def run(self, max_instructions=None):
        self.running = True
        count = 0
        while self.running:
            if self.pc in self.breakpoints:
                break
            result = self.step()
            count += 1
            if result == 'ecall':
                break
            if max_instructions and count >= max_instructions:
                break
        return count

    def add_breakpoint(self, address):
        self.breakpoints.add(address)

    def remove_breakpoint(self, address):
        self.breakpoints.discard(address)

    def get_registers(self):
        regs = {}
        for i, name in enumerate(self.REGISTER_NAMES):
            regs[name] = self.registers[i]
        return regs

    def dump_registers(self):
        lines = []
        for i in range(0, 32, 4):
            row = []
            for j in range(4):
                idx = i + j
                name = self.REGISTER_NAMES[idx]
                value = self.registers[idx]
                row.append(f"{name:4s} = {value:08x}")
            lines.append("  ".join(row))
        lines.append(f"pc   = {self.pc:08x}")
        return "\n".join(lines)
