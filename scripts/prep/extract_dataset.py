"""Extract only the three expected dataset members with CRC and path checks."""
import argparse
import os
import stat
import zlib
from pathlib import Path
from zipfile import BadZipFile, ZipFile

EXPECTED = {'query_clicks.parquet', 'sku_desc.parquet', 'skus.pkl'}
MAX_MEMBER_BYTES = 3 * 1024**3
MAX_TOTAL_BYTES = 5 * 1024**3


def crc32_file(path):
    checksum = 0
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            checksum = zlib.crc32(chunk, checksum)
    return checksum


def extract_dataset(source, target):
    target = Path(target).resolve()
    with ZipFile(source) as archive:
        members = archive.infolist()
        names = [entry.filename for entry in members]
        if len(names) != len(EXPECTED) or set(names) != EXPECTED:
            raise ValueError(f'Archive must contain exactly {sorted(EXPECTED)} once each')
        if sum(entry.file_size for entry in members) > MAX_TOTAL_BYTES:
            raise ValueError('Archive declares too much uncompressed data')
        for entry in members:
            mode = entry.external_attr >> 16
            kind = stat.S_IFMT(mode)
            if (entry.is_dir() or entry.flag_bits & 1 or kind not in (0, stat.S_IFREG)
                    or entry.file_size > MAX_MEMBER_BYTES or entry.file_size < 4):
                raise ValueError(f'Unsupported archive member: {entry.filename}')
        target.mkdir(parents=True, exist_ok=True)
        for entry in members:
            destination = target / entry.filename
            if destination.is_symlink() or destination.parent.resolve() != target:
                raise ValueError(f'Unsafe destination: {entry.filename}')
            if (destination.exists() and destination.is_file()
                    and destination.stat().st_size == entry.file_size
                    and crc32_file(destination) == entry.CRC):
                print(f'OK {entry.filename}: existing CRC verified', flush=True)
                continue
            temporary = target / f'.{entry.filename}.partial'
            if temporary.exists() or temporary.is_symlink():
                temporary.unlink()
            try:
                print(f'Extracting {entry.filename}: {entry.file_size} bytes', flush=True)
                with archive.open(entry) as src, temporary.open('xb') as dst:
                    for chunk in iter(lambda: src.read(4 * 1024 * 1024), b''):
                        dst.write(chunk)
                if temporary.stat().st_size != entry.file_size or crc32_file(temporary) != entry.CRC:
                    raise BadZipFile(f'CRC or size mismatch: {entry.filename}')
                os.replace(temporary, destination)
                print(f'OK {entry.filename}: CRC verified', flush=True)
            finally:
                temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--target', type=Path, default=Path('work/dataset'))
    args = parser.parse_args()
    extract_dataset(args.archive, args.target)
