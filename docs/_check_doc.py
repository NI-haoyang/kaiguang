
import glob, os
from docx import Document
d = glob.glob(r"C:\Users\Frankni\Documents\deepseek-harness\default-workspace\kaiguang\docs\*.docx")[0]
print("FILE:", os.path.basename(d), os.path.getsize(d), "bytes")
doc = Document(d)
print("paragraphs:", len(doc.paragraphs), "tables:", len(doc.tables))
heads = [p.text for p in doc.paragraphs if p.text.strip() and (p.runs and p.runs[0].font.size and p.runs[0].font.size.pt >= 15)]
print("headings:", " | ".join(heads[:20]))
print("first:", doc.paragraphs[0].text, "|", doc.paragraphs[1].text)
t = doc.tables[1]
print("table2 rows:", len(t.rows), "cols:", len(t.columns))
