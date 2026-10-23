"""Find memo entries actually referenced in the pickle without executing it."""
import pickletools
import time
from pathlib import Path

source = Path('work/dataset/skus.pkl')
destination = Path('work/dataset/memo_refs.bin')
bits = bytearray()
memo_count = 0
reference_count = 0
unique_count = 0
last_progress = 0
started = time.time()
with source.open('rb') as file:
    for opcode, arg, position in pickletools.genops(file):
        name = opcode.name
        if name == 'MEMOIZE':
            memo_count += 1
        elif name in ('BINGET', 'LONG_BINGET', 'GET'):
            idx = int(arg)
            byte = idx >> 3
            if byte >= len(bits): bits.extend(b'\x00' * (byte + 1 - len(bits)))
            mask = 1 << (idx & 7)
            if not bits[byte] & mask:
                bits[byte] |= mask
                unique_count += 1
            reference_count += 1
        elif name in ('GLOBAL', 'STACK_GLOBAL', 'REDUCE', 'BUILD', 'NEWOBJ', 'NEWOBJ_EX', 'INST', 'OBJ'):
            raise RuntimeError(f'Unsafe object opcode {name} at {position}')
        if position - last_progress >= 200_000_000:
            print(f'PROGRESS {position / 1e9:.2f} GB, {memo_count:,} memo, {time.time()-started:.0f}s', flush=True)
            last_progress = position
destination.write_bytes(bits)
print(f'DONE memo={memo_count:,} refs={reference_count:,} unique={unique_count:,} bytes={len(bits):,} seconds={time.time()-started:.0f}', flush=True)
