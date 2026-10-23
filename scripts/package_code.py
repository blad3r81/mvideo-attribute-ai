"""Create a runnable source archive without the 300 MB batch prediction export."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from datetime import date

root = Path(__file__).resolve().parent.parent
output = root.parent / f"mvideo-attribute-ai-code-{date.today().isoformat()}.zip"
folders = ("api", "config", "data", "docs", "presentation", "public", "reports", "scripts", "src", "test")
top_files = ("README.md", "package.json", "requirements.txt", "vercel.json", ".env.example", ".vercelignore", ".gitignore", ".dockerignore", "Dockerfile")
excluded_names = {"predictions_full.jsonl.gz", "predictions_v2.jsonl.gz"}

with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=6) as archive:
    for name in top_files:
        archive.write(root / name, name)
    for folder in folders:
        for path in sorted((root / folder).rglob("*")):
            if not path.is_file() or path.name in excluded_names or "__pycache__" in path.parts:
                continue
            archive.write(path, path.relative_to(root).as_posix())
    archive.writestr(
        "CODE_ARCHIVE_README.txt",
        "Запуск: Node.js 20+, установить DEMO_MODE=1, затем node src/server.js; адрес http://127.0.0.1:4174.\n"
        "Все исходники, тесты, конфигурация, UI и демонстрационные карточки включены.\n"
        "Полная пакетная выгрузка predictions_full.jsonl.gz не включена из-за размера. "
        "Она хранится отдельно в локальном рабочем проекте и воспроизводится по README.\n",
    )

print(f"{output} ({output.stat().st_size:,} bytes)")
