INPUT_FILE = ""
OUTPUT_FILE = ""

with open(INPUT_FILE, "rb") as f:
    data = f.read()

records = data.split(b"{EOR}")

with open(OUTPUT_FILE, "w", encoding="latin1", errors="ignore") as out:
    for rec in records:
        cleaned = rec.replace(b"\x00", b"")

        if cleaned:
            line = cleaned.decode("latin1", errors="ignore") + '\n'

            out.write(line)
        
        # print("Index | Character | Unicode | Note")
        # print("----------------------------------")
        # for i, ch in enumerate(line):
        #     note = "" 
        #     if ch == '\t': 
        #         note = "<TAB>" 
        #     elif ch == ' ':
        #         note = "<SPACE>"
        #     print(f"{i:5} | {repr(ch):9} | {ord(ch):7} | {note}")
        # break