def encode_r_type(funct7, rs2, rs1, funct3, rd, opcode):
    return (funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode

def encode_i_type(imm, rs1, funct3, rd, opcode):
    imm = imm & 0xFFF
    return (imm << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode

def encode_s_type(imm, rs2, rs1, funct3, opcode):
    imm = imm & 0xFFF
    imm_11_5 = (imm >> 5) & 0x7F
    imm_4_0 = imm & 0x1F
    return (imm_11_5 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (imm_4_0 << 7) | opcode

def encode_b_type(imm, rs2, rs1, funct3, opcode):
    imm = imm & 0x1FFF
    imm_12 = (imm >> 12) & 0x1
    imm_11 = (imm >> 11) & 0x1
    imm_10_5 = (imm >> 5) & 0x3F
    imm_4_1 = (imm >> 1) & 0xF
    return (imm_12 << 31) | (imm_11 << 7) | (imm_10_5 << 25) | (imm_4_1 << 8) | (funct3 << 12) | (rs2 << 20) | (rs1 << 15) | opcode

def encode_u_type(imm, rd, opcode):
    imm = imm & 0xFFFFF000
    return imm | (rd << 7) | opcode

def encode_j_type(imm, rd, opcode):
    imm = imm & 0x1FFFFF
    imm_20 = (imm >> 20) & 0x1
    imm_19_12 = (imm >> 12) & 0xFF
    imm_11 = (imm >> 11) & 0x1
    imm_10_1 = (imm >> 1) & 0x3FF
    return (imm_20 << 31) | (imm_19_12 << 12) | (imm_11 << 20) | (imm_10_1 << 21) | (rd << 7) | opcode


def create_fibonacci_binary(n=10):
    instructions = []
    
    instructions.append(encode_i_type(n, 0, 0, 10, 0x13))
    instructions.append(encode_i_type(0, 0, 0, 5, 0x13))
    instructions.append(encode_i_type(1, 0, 0, 6, 0x13))
    
    instructions.append(encode_b_type(28, 0, 10, 0, 0x63))
    
    instructions.append(encode_r_type(0, 6, 5, 0, 7, 0x33))
    instructions.append(encode_r_type(0, 6, 0, 0, 5, 0x33))
    instructions.append(encode_r_type(0, 7, 0, 0, 6, 0x33))
    instructions.append(encode_i_type(-1, 10, 0, 10, 0x13))
    instructions.append(encode_b_type(-16, 0, 10, 1, 0x63))
    
    instructions.append(encode_r_type(0, 5, 0, 0, 10, 0x33))
    instructions.append(encode_i_type(0, 0, 0, 0, 0x73))
    
    binary = bytearray()
    for instr in instructions:
        binary.append(instr & 0xFF)
        binary.append((instr >> 8) & 0xFF)
        binary.append((instr >> 16) & 0xFF)
        binary.append((instr >> 24) & 0xFF)
    
    return bytes(binary)


def create_simple_test_binary():
    instructions = [
        0x00500513,
        0x00a00593,
        0x00b50533,
        0x00000073,
    ]
    
    binary = bytearray()
    for instr in instructions:
        binary.append(instr & 0xFF)
        binary.append((instr >> 8) & 0xFF)
        binary.append((instr >> 16) & 0xFF)
        binary.append((instr >> 24) & 0xFF)
    
    return bytes(binary)


def create_nested_call_binary():
    instructions = [
        0x00300513,
        0x008000ef,
        0x00000073,
        0x00a00593,
        0x00c000ef,
        0x00b50533,
        0x00008067,
        0x01400613,
        0x00c000ef,
        0x00c585b3,
        0x00008067,
        0x01e00693,
        0x00d60633,
        0x00008067,
    ]
    
    binary = bytearray()
    for instr in instructions:
        binary.append(instr & 0xFF)
        binary.append((instr >> 8) & 0xFF)
        binary.append((instr >> 16) & 0xFF)
        binary.append((instr >> 24) & 0xFF)
    
    return bytes(binary)


def create_recursive_fib_binary(n=5):
    instructions = []
    
    instructions.append(encode_i_type(n, 0, 0, 10, 0x13))
    instructions.append(encode_j_type(8, 1, 0x6F))
    
    instructions.append(encode_i_type(0, 0, 0, 5, 0x13))
    instructions.append(encode_i_type(0, 1, 0, 0, 0x67))
    
    instructions.append(encode_b_type(12, 10, 5, 1, 0x63))
    instructions.append(encode_i_type(1, 0, 0, 10, 0x13))
    instructions.append(encode_i_type(0, 1, 0, 0, 0x67))
    
    instructions.append(encode_i_type(-1, 10, 0, 10, 0x13))
    instructions.append(encode_i_type(-4, 2, 0, 2, 0x13))
    instructions.append(encode_s_type(0, 1, 2, 2, 0x23))
    instructions.append(encode_j_type(-28, 1, 0x6F))
    
    binary = bytearray()
    for instr in instructions:
        binary.append(instr & 0xFF)
        binary.append((instr >> 8) & 0xFF)
        binary.append((instr >> 16) & 0xFF)
        binary.append((instr >> 24) & 0xFF)
    
    return bytes(binary)


if __name__ == "__main__":
    fib_bin = create_fibonacci_binary(10)
    with open("fibonacci.bin", "wb") as f:
        f.write(fib_bin)
    print(f"Generated fibonacci.bin, size: {len(fib_bin)} bytes")
    
    test_bin = create_simple_test_binary()
    with open("simple_test.bin", "wb") as f:
        f.write(test_bin)
    print(f"Generated simple_test.bin, size: {len(test_bin)} bytes")
    
    nested_bin = create_nested_call_binary()
    with open("nested_call.bin", "wb") as f:
        f.write(nested_bin)
    print(f"Generated nested_call.bin, size: {len(nested_bin)} bytes")
