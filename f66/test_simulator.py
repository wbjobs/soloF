from riscv_simulator import RiscvSimulator
from fibonacci import create_fibonacci_binary, create_simple_test_binary, create_nested_call_binary


def test_simple_add():
    print("=== Test 1: Simple Addition ===")
    sim = RiscvSimulator()
    binary = create_simple_test_binary()
    sim.load_binary(binary, 0)
    
    sim.step()
    assert sim.registers[10] == 5, f"Expected a0=5, got {sim.registers[10]}"
    print(f"  Step 1: addi a0, zero, 5 -> a0 = {sim.registers[10]}")
    
    sim.step()
    assert sim.registers[11] == 10, f"Expected a1=10, got {sim.registers[11]}"
    print(f"  Step 2: addi a1, zero, 10 -> a1 = {sim.registers[11]}")
    
    sim.step()
    assert sim.registers[10] == 15, f"Expected a0=15, got {sim.registers[10]}"
    print(f"  Step 3: add a0, a0, a1 -> a0 = {sim.registers[10]}")
    
    print("  PASSED!")
    return True


def test_fibonacci():
    print("\n=== Test 2: Fibonacci Program ===")
    sim = RiscvSimulator()
    binary = create_fibonacci_binary(10)
    sim.load_binary(binary, 0)
    
    count = sim.run(max_instructions=1000)
    fib_10 = sim.registers[10]
    
    print(f"  Executed {count} instructions")
    print(f"  Fibonacci(10) = {fib_10}")
    
    expected = 55
    assert fib_10 == expected, f"Expected Fibonacci(10)={expected}, got {fib_10}"
    print("  PASSED!")
    return True


def test_breakpoints():
    print("\n=== Test 3: Breakpoints ===")
    sim = RiscvSimulator()
    binary = create_simple_test_binary()
    sim.load_binary(binary, 0)
    
    sim.add_breakpoint(8)
    
    count = sim.run(max_instructions=100)
    print(f"  Stopped at PC: 0x{sim.pc:08x}")
    print(f"  a0 = {sim.registers[10]}, a1 = {sim.registers[11]}")
    
    assert sim.pc == 8, f"Expected PC=8, got {sim.pc}"
    assert sim.registers[10] == 5, f"Expected a0=5, got {sim.registers[10]}"
    assert sim.registers[11] == 10, f"Expected a1=10, got {sim.registers[11]}"
    
    sim.remove_breakpoint(8)
    count2 = sim.run(max_instructions=100)
    print(f"  Continued, executed {count2} more instructions")
    print(f"  Final a0 = {sim.registers[10]}")
    
    assert sim.registers[10] == 15, f"Expected a0=15, got {sim.registers[10]}"
    print("  PASSED!")
    return True


def test_memory():
    print("\n=== Test 4: Memory Operations ===")
    sim = RiscvSimulator()
    
    sim.write_memory(0x100, 0xdeadbeef, 4)
    val = sim.read_memory(0x100, 4)
    print(f"  Write 0xdeadbeef to 0x100, read back: 0x{val:08x}")
    assert val == 0xdeadbeef, f"Expected 0xdeadbeef, got 0x{val:08x}"
    
    sim.write_memory(0x104, 0x42, 1)
    val = sim.read_memory(0x104, 1)
    print(f"  Write 0x42 to 0x104 (byte), read back: 0x{val:02x}")
    assert val == 0x42, f"Expected 0x42, got 0x{val:02x}"
    
    print("  PASSED!")
    return True


def test_registers():
    print("\n=== Test 5: Register Operations ===")
    sim = RiscvSimulator()
    
    sim.write_register('t0', 123)
    val = sim.read_register('t0')
    print(f"  Write t0=123, read back: {val}")
    assert val == 123, f"Expected 123, got {val}"
    
    sim.write_register('x5', 456)
    val = sim.read_register('t0')
    print(f"  Write x5=456, read t0: {val}")
    assert val == 456, f"Expected 456, got {val}"
    
    sim.write_register('zero', 999)
    val = sim.read_register('zero')
    print(f"  Write zero=999, read back: {val}")
    assert val == 0, f"Expected zero to always be 0, got {val}"
    
    print("  PASSED!")
    return True


def test_fibonacci_breakpoint():
    print("\n=== Test 6: Fibonacci with Breakpoint ===")
    sim = RiscvSimulator()
    binary = create_fibonacci_binary(10)
    sim.load_binary(binary, 0)
    
    loop_addr = 0x10
    sim.add_breakpoint(loop_addr)
    print(f"  Set breakpoint at loop address: 0x{loop_addr:08x}")
    
    hit_count = 0
    for i in range(20):
        count = sim.run(max_instructions=1000)
        if sim.pc == loop_addr:
            hit_count += 1
            fib_val = sim.registers[5]
            print(f"  Hit breakpoint #{hit_count}: PC=0x{sim.pc:08x}, fib(t0)={fib_val}")
            sim.step()
        else:
            print(f"  Program finished, a0={sim.registers[10]}")
            break
    
    assert hit_count >= 3, f"Expected at least 3 breakpoint hits, got {hit_count}"
    print("  PASSED!")
    return True


def test_backtrace():
    print("\n=== Test 7: Backtrace (Call Stack) ===")
    sim = RiscvSimulator()
    binary = create_nested_call_binary()
    sim.load_binary(binary, 0)
    
    print("  Disassembly of nested_call.bin:")
    for i in range(len(binary) // 4):
        instr = sim.read_memory(i * 4, 4)
        print(f"    0x{i*4:08x}: 0x{instr:08x}")
    
    sim.step()
    print(f"  After step 1: PC=0x{sim.pc:08x}, call stack depth={len(sim.get_call_stack())}")
    
    sim.step()
    print(f"  After step 2 (call func_a): PC=0x{sim.pc:08x}, call stack depth={len(sim.get_call_stack())}")
    assert len(sim.get_call_stack()) == 1, f"Expected call stack depth 1, got {len(sim.get_call_stack())}"
    
    sim.step()
    sim.step()
    print(f"  After step 4 (call func_b): PC=0x{sim.pc:08x}, call stack depth={len(sim.get_call_stack())}")
    assert len(sim.get_call_stack()) == 2, f"Expected call stack depth 2, got {len(sim.get_call_stack())}"
    
    sim.step()
    sim.step()
    print(f"  After step 6 (call func_c): PC=0x{sim.pc:08x}, call stack depth={len(sim.get_call_stack())}")
    assert len(sim.get_call_stack()) == 3, f"Expected call stack depth 3, got {len(sim.get_call_stack())}"
    
    call_stack = sim.get_call_stack()
    print(f"  Call stack:")
    for i, frame in enumerate(reversed(call_stack)):
        print(f"    #{len(call_stack)-1-i} func=0x{frame['func_addr']:08x}, return=0x{frame['return_addr']:08x}")
    
    sim.step()
    sim.step()
    sim.step()
    print(f"  After returns: PC=0x{sim.pc:08x}, call stack depth={len(sim.get_call_stack())}")
    
    count = sim.run(max_instructions=100)
    print(f"  Program finished, a0={sim.registers[10]}")
    print("  PASSED!")
    return True


def main():
    tests = [
        test_simple_add,
        test_fibonacci,
        test_breakpoints,
        test_memory,
        test_registers,
        test_fibonacci_breakpoint,
        test_backtrace,
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            if test():
                passed += 1
        except Exception as e:
            print(f"  FAILED: {e}")
            failed += 1
    
    print(f"\n{'='*50}")
    print(f"Results: {passed} passed, {failed} failed")
    print(f"{'='*50}")
    
    return failed == 0


if __name__ == "__main__":
    import sys
    success = main()
    sys.exit(0 if success else 1)
