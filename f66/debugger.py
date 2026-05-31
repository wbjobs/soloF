import sys
from riscv_simulator import RiscvSimulator


class Debugger:
    def __init__(self, simulator):
        self.sim = simulator
        self.commands = {
            'help': self.cmd_help,
            'h': self.cmd_help,
            'step': self.cmd_step,
            's': self.cmd_step,
            'continue': self.cmd_continue,
            'c': self.cmd_continue,
            'break': self.cmd_break,
            'b': self.cmd_break,
            'delete': self.cmd_delete,
            'd': self.cmd_delete,
            'print': self.cmd_print,
            'p': self.cmd_print,
            'registers': self.cmd_registers,
            'r': self.cmd_registers,
            'memory': self.cmd_memory,
            'm': self.cmd_memory,
            'x': self.cmd_memory,
            'reset': self.cmd_reset,
            'info': self.cmd_info,
            'i': self.cmd_info,
            'disassemble': self.cmd_disassemble,
            'dis': self.cmd_disassemble,
            'backtrace': self.cmd_backtrace,
            'bt': self.cmd_backtrace,
            'quit': self.cmd_quit,
            'q': self.cmd_quit,
            'exit': self.cmd_quit,
        }

    def print_help(self):
        print("RISC-V Debugger Commands:")
        print("  help (h)              - Show this help message")
        print("  step (s)              - Execute one instruction")
        print("  continue (c)          - Continue execution until breakpoint or end")
        print("  break (b) <address>   - Set breakpoint at address")
        print("  delete (d) <address>  - Remove breakpoint at address")
        print("  print (p) register <name>  - Print register value")
        print("  print (p) memory <addr> <size> - Print memory value")
        print("  registers (r)         - Print all registers")
        print("  memory (m/x) <addr> <count> - Dump memory")
        print("  reset                 - Reset simulator")
        print("  info (i) breakpoints  - Show breakpoints")
        print("  disassemble (dis) <addr> <count> - Disassemble instructions")
        print("  backtrace (bt)        - Show function call stack")
        print("  quit (q/exit)         - Exit debugger")

    def cmd_help(self, args):
        self.print_help()

    def cmd_step(self, args):
        if self.sim.running and self.sim.pc in self.sim.breakpoints:
            print(f"Hit breakpoint at 0x{self.sim.pc:08x}")
        try:
            result = self.sim.step()
            instr = self._disassemble_at(self.sim.pc - 4)
            print(f"0x{self.sim.pc - 4:08x}: {instr}")
            if result == 'ecall':
                print(f"Program exited (ecall). a0 = {self.sim.registers[10]}")
        except Exception as e:
            print(f"Error: {e}")

    def cmd_continue(self, args):
        try:
            count = self.sim.run()
            print(f"Executed {count} instructions")
            if self.sim.pc in self.sim.breakpoints:
                print(f"Hit breakpoint at 0x{self.sim.pc:08x}")
            else:
                print(f"Program stopped. a0 = {self.sim.registers[10]}")
        except Exception as e:
            print(f"Error: {e}")

    def cmd_break(self, args):
        if not args:
            print("Usage: break <address>")
            return
        try:
            addr = int(args[0], 0)
            if addr % 4 != 0:
                print(f"Warning: Address 0x{addr:08x} is not 4-byte aligned (RISC-V instructions must be word-aligned)")
            if addr >= self.sim.memory_size:
                print(f"Warning: Address 0x{addr:08x} is beyond memory size (0x{self.sim.memory_size:08x})")
            self.sim.add_breakpoint(addr)
            print(f"Breakpoint set at 0x{addr:08x}")
        except ValueError:
            print(f"Invalid address: {args[0]}")

    def cmd_delete(self, args):
        if not args:
            print("Usage: delete <address>")
            return
        try:
            addr = int(args[0], 0)
            self.sim.remove_breakpoint(addr)
            print(f"Breakpoint removed at 0x{addr:08x}")
        except ValueError:
            print(f"Invalid address: {args[0]}")

    def cmd_print(self, args):
        if not args:
            print("Usage: print register <name> | print memory <addr> <size>")
            return
        subcmd = args[0].lower()
        if subcmd == 'register' or subcmd == 'reg':
            if len(args) < 2:
                print("Usage: print register <name>")
                return
            try:
                value = self.sim.read_register(args[1])
                print(f"{args[1]} = {value} (0x{value:08x})")
            except ValueError as e:
                print(f"Error: {e}")
        elif subcmd == 'memory' or subcmd == 'mem':
            if len(args) < 2:
                print("Usage: print memory <addr> [size]")
                return
            try:
                addr = int(args[1], 0)
                size = int(args[2]) if len(args) > 2 else 4
                value = self.sim.read_memory(addr, size)
                print(f"Memory[0x{addr:08x}] = {value} (0x{value:x})")
            except ValueError:
                print(f"Invalid address")
            except Exception as e:
                print(f"Error: {e}")
        else:
            print(f"Unknown print subcommand: {subcmd}")

    def cmd_registers(self, args):
        print(self.sim.dump_registers())

    def cmd_memory(self, args):
        if not args:
            print("Usage: memory <addr> [count]")
            return
        try:
            addr = int(args[0], 0)
            count = int(args[1]) if len(args) > 1 else 16
            for i in range(0, count, 4):
                if addr + i >= self.sim.memory_size:
                    break
                val = self.sim.read_memory(addr + i, 4)
                print(f"0x{addr + i:08x}: 0x{val:08x}  ", end="")
                for j in range(4):
                    byte = (val >> (j * 8)) & 0xFF
                    if 32 <= byte < 127:
                        print(chr(byte), end="")
                    else:
                        print(".", end="")
                print()
        except ValueError:
            print("Invalid address")
        except Exception as e:
            print(f"Error: {e}")

    def cmd_reset(self, args):
        self.sim.reset()
        print("Simulator reset")

    def cmd_info(self, args):
        if not args:
            print("Usage: info breakpoints")
            return
        subcmd = args[0].lower()
        if subcmd == 'breakpoints' or subcmd == 'b':
            if self.sim.breakpoints:
                print("Breakpoints:")
                for bp in sorted(self.sim.breakpoints):
                    print(f"  0x{bp:08x}")
            else:
                print("No breakpoints")
        else:
            print(f"Unknown info subcommand: {subcmd}")

    def _disassemble_at(self, addr):
        try:
            instr = self.sim.read_memory(addr, 4)
            return self._disassemble_instr(instr)
        except:
            return "???"

    def _disassemble_instr(self, instr):
        opcode = instr & 0x7F
        rd = (instr >> 7) & 0x1F
        funct3 = (instr >> 12) & 0x7
        rs1 = (instr >> 15) & 0x1F
        rs2 = (instr >> 20) & 0x1F
        funct7 = (instr >> 25) & 0x7F

        regs = RiscvSimulator.REGISTER_NAMES

        if opcode == 0x37:
            imm = (instr >> 12) << 12
            return f"lui {regs[rd]}, 0x{imm:x}"
        elif opcode == 0x17:
            imm = (instr >> 12) << 12
            return f"auipc {regs[rd]}, 0x{imm:x}"
        elif opcode == 0x6F:
            imm = ((instr >> 21) & 0x3FF) << 1
            imm |= ((instr >> 20) & 0x1) << 11
            imm |= ((instr >> 12) & 0xFF) << 12
            if instr >> 31:
                imm -= 0x100000
            return f"jal {regs[rd]}, 0x{imm:x}"
        elif opcode == 0x67:
            imm = (instr >> 20) & 0xFFF
            if imm & 0x800:
                imm -= 0x1000
            return f"jalr {regs[rd]}, {imm}({regs[rs1]})"
        elif opcode == 0x63:
            imm = ((instr >> 8) & 0xF) << 1
            imm |= ((instr >> 25) & 0x3F) << 5
            imm |= ((instr >> 7) & 0x1) << 11
            if instr >> 31:
                imm -= 0x1000
            cc = ['beq', 'bne', '', '', 'blt', 'bge', 'bltu', 'bgeu'][funct3]
            return f"{cc} {regs[rs1]}, {regs[rs2]}, 0x{imm:x}"
        elif opcode == 0x03:
            imm = (instr >> 20) & 0xFFF
            if imm & 0x800:
                imm -= 0x1000
            lw = ['lb', 'lh', 'lw', '', 'lbu', 'lhu', '', ''][funct3]
            return f"{lw} {regs[rd]}, {imm}({regs[rs1]})"
        elif opcode == 0x23:
            imm = ((instr >> 7) & 0x1F) | ((instr >> 25) << 5)
            if imm & 0x800:
                imm -= 0x1000
            sw = ['sb', 'sh', 'sw', '', '', '', '', ''][funct3]
            return f"{sw} {regs[rs2]}, {imm}({regs[rs1]})"
        elif opcode == 0x13:
            imm = (instr >> 20) & 0xFFF
            if imm & 0x800:
                imm -= 0x1000
            if funct3 == 0x0:
                return f"addi {regs[rd]}, {regs[rs1]}, {imm}"
            elif funct3 == 0x2:
                return f"slti {regs[rd]}, {regs[rs1]}, {imm}"
            elif funct3 == 0x3:
                return f"sltiu {regs[rd]}, {regs[rs1]}, {imm}"
            elif funct3 == 0x4:
                return f"xori {regs[rd]}, {regs[rs1]}, {imm}"
            elif funct3 == 0x6:
                return f"ori {regs[rd]}, {regs[rs1]}, {imm}"
            elif funct3 == 0x7:
                return f"andi {regs[rd]}, {regs[rs1]}, {imm}"
            elif funct3 == 0x1:
                return f"slli {regs[rd]}, {regs[rs1]}, {imm & 0x1F}"
            elif funct3 == 0x5:
                if (imm >> 10) & 0x1:
                    return f"srai {regs[rd]}, {regs[rs1]}, {imm & 0x1F}"
                else:
                    return f"srli {regs[rd]}, {regs[rs1]}, {imm & 0x1F}"
        elif opcode == 0x33:
            if funct7 == 0x00:
                op = ['add', 'sll', 'slt', 'sltu', 'xor', 'srl', 'or', 'and'][funct3]
                return f"{op} {regs[rd]}, {regs[rs1]}, {regs[rs2]}"
            elif funct7 == 0x20:
                if funct3 == 0x0:
                    return f"sub {regs[rd]}, {regs[rs1]}, {regs[rs2]}"
                elif funct3 == 0x5:
                    return f"sra {regs[rd]}, {regs[rs1]}, {regs[rs2]}"
        elif opcode == 0x73:
            return "ecall"

        return f"unknown 0x{instr:08x}"

    def cmd_disassemble(self, args):
        if not args:
            print("Usage: disassemble <addr> [count]")
            return
        try:
            addr = int(args[0], 0)
            count = int(args[1]) if len(args) > 1 else 10
            for i in range(count):
                instr = self.sim.read_memory(addr + i * 4, 4)
                disasm = self._disassemble_instr(instr)
                print(f"0x{addr + i * 4:08x}: 0x{instr:08x}  {disasm}")
        except ValueError:
            print("Invalid address")
        except Exception as e:
            print(f"Error: {e}")

    def cmd_backtrace(self, args):
        call_stack = self.sim.get_call_stack()
        if not call_stack:
            print("No function calls in stack (depth = 0)")
            return
        
        print(f"Call stack (depth = {len(call_stack)}):")
        for i, frame in enumerate(reversed(call_stack)):
            frame_num = len(call_stack) - 1 - i
            caller_instr = self._disassemble_at(frame['caller_pc'])
            print(f"  #{frame_num} 0x{frame['func_addr']:08x} in function")
            print(f"     called from 0x{frame['caller_pc']:08x}: {caller_instr}")
            print(f"     return address: 0x{frame['return_addr']:08x}")
        
        print(f"  #0  0x{self.sim.pc:08x} current PC")

    def cmd_quit(self, args):
        print("Exiting debugger")
        sys.exit(0)

    def run(self):
        print("RISC-V Simulator Debugger")
        print("Type 'help' for commands")
        print(f"PC: 0x{self.sim.pc:08x}")

        while True:
            try:
                line = input(f"(debug) ").strip()
                if not line:
                    continue

                parts = line.split()
                cmd = parts[0].lower()
                args = parts[1:]

                if cmd in self.commands:
                    self.commands[cmd](args)
                else:
                    print(f"Unknown command: {cmd}. Type 'help' for available commands.")
            except KeyboardInterrupt:
                print()
                continue
            except EOFError:
                print()
                break


def main():
    if len(sys.argv) < 2:
        print("Usage: python debugger.py <binary_file>")
        sys.exit(1)

    binary_file = sys.argv[1]

    try:
        with open(binary_file, 'rb') as f:
            binary_data = f.read()
    except FileNotFoundError:
        print(f"Error: File not found: {binary_file}")
        sys.exit(1)

    sim = RiscvSimulator()
    sim.load_binary(binary_data, start_address=0)

    dbg = Debugger(sim)
    dbg.run()


if __name__ == "__main__":
    main()
