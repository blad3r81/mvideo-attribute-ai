"""Small archive safety tests; run with python -m unittest discover -s test -p 'archive_validation.py'."""
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'prep'))
from extract_dataset import EXPECTED, extract_dataset


class ArchiveValidation(unittest.TestCase):
    def test_exact_members_extract_and_crc_reuse(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'valid.zip'
            with ZipFile(archive, 'w') as output:
                for name in EXPECTED:
                    output.writestr(name, b'data')
            target = root / 'result'
            extract_dataset(archive, target)
            (target / 'skus.pkl').write_bytes(b'bad!')
            extract_dataset(archive, target)
            self.assertEqual((target / 'skus.pkl').read_bytes(), b'data')

    def test_reject_duplicate_and_traversal_names(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for extra in ('skus.pkl', '../outside.txt'):
                archive = root / ('duplicate.zip' if extra == 'skus.pkl' else 'traversal.zip')
                with ZipFile(archive, 'w') as output:
                    for name in EXPECTED:
                        output.writestr(name, b'data')
                    output.writestr(extra, b'evil')
                with self.assertRaises(ValueError):
                    extract_dataset(archive, root / 'result')
                self.assertFalse((root / 'outside.txt').exists())


if __name__ == '__main__':
    unittest.main()
