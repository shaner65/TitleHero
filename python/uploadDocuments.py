import os
import re
import uuid
import pymysql
import boto3
from datetime import datetime

# --- CONFIGURATION ---

BASE_DIR = ''
S3_BUCKET = ''
COUNTY_ID = 1
BASE_S3_DIR = 'Washington/'

DB_CONFIG = {
    'host': '',
    'user': '',
    'password': '',
    'database': '',
    'cursorclass': pymysql.cursors.DictCursor
}

# --- HELPERS ---

def base36_encode(number):
    """Encode integer to zero-padded 9-character base36 string."""
    chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    if number == 0:
        return chars[0]*9
    result = ''
    while number > 0:
        number, i = divmod(number, 36)
        result = chars[i] + result
    return result.zfill(9)

def upload_to_s3(file_path, bucket, key):
    """Uploads a file to AWS S3 with the given key."""
    s3 = boto3.client('s3')
    s3.upload_file(file_path, bucket, key)
    print(f"Uploaded '{file_path}' as '{key}' to bucket '{bucket}'")

def format_dates(fileDate_str, fileStampDate_str):
    fileDate_dt = datetime.strptime(fileDate_str, '%m%d%Y').date()
    fileStampDate_dt = datetime.strptime(fileStampDate_str, '%m%d%Y%H:%M')
    
    return {
        'fileDate': fileDate_dt.strftime('%Y-%m-%d'),
        'fileStampDate': fileStampDate_dt.strftime('%Y-%m-%d %H:%M:%S')
    }

# --- PARSERS ---

def parse_index1(file_path):
    """
    Parses a fixed-width file.

    Args:
        file_path (str): Path to the fixed-width file.
        columns (list of tuples): Each tuple is (column_name, width).

    Returns:
        List of dicts, each dict represents a parsed line keyed by column names.
    """
    data = []

    columns = [
        ('FileName', 30),
        ('Grantor', 40),
        ('Grantee', 40),
        ('instrumentType', 22),
        ('fileStampDate', 22),
        ('fileDate', 8),
        ('legalDescription', 42),
        ('filename', None),
    ]


    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            pos = 0
            record = {}
            for i, (col_name, width) in enumerate(columns):
                if width is None:
                    # Take rest of line for last column
                    raw_value = line[pos:].rstrip('\n')
                    record[col_name] = raw_value.strip()
                    break
                else:
                    raw_value = line[pos:pos+width]
                    record[col_name] = raw_value.strip()
                    pos += width
            record['fileStampDate'] = record['fileStampDate'][9:]

            formatted_dates = format_dates(record['fileDate'],record['fileStampDate'])

            record['fileStampDate'] = formatted_dates['fileStampDate']
            record['fileDate'] = formatted_dates['fileDate']

            data.append(record)

    return data

def parse_index2(file_path):
    """
    Parses INDEX2.txt pipe-delimited.
    Returns dict of grantors and grantees keyed by filename.
    """
    data = {
        'grantors': {},
        'grantees': {}
    }

    if not os.path.exists(file_path):
        return data

    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            parts = line.strip().split('|')
            if len(parts) < 4:
                continue
            filename = os.path.basename(parts[0].strip().replace('\\', '/'))
            grantor = parts[2].strip()
            grantee = parts[3].strip()

            if grantor:
                data['grantors'].setdefault(filename, set()).add(grantor)
            if grantee:
                data['grantees'].setdefault(filename, set()).add(grantee)

    return data

# --- MAIN PROCESSING FUNCTION ---

def process_folder(folder_path, connection, bucket_name):
    print(f"Processing folder: {folder_path}")

    index1_path = os.path.join(folder_path, 'INDEX1.TXT')
    index2_path = os.path.join(folder_path, 'INDEX2.TXT')

    if not os.path.exists(index1_path):
        print(f"Missing INDEX1.txt in {folder_path}, skipping.")
        return

    index1_data = parse_index1(index1_path)  # list of dicts
    index2_data = parse_index2(index2_path)  # dict with 'grantors' and 'grantees'

    documents = index1_data  # list of dicts now

    with connection.cursor() as cursor:
        for metadata in documents:
            filename = metadata.get('FileName')
            if not filename:
                print("Skipping record without FileName")
                continue

            # Combine grantors/grantees from both indexes for this filename
            grantors = set()
            grantees = set()

            # index1_data is list, so no direct lookup; must scan or skip
            # But since grantors/grantees sets are only in index2_data, we get from there:
            grantors.update(index2_data['grantors'].get(filename, set()))
            grantees.update(index2_data['grantees'].get(filename, set()))

            # Also add grantor/grantee from current metadata (index1 line)
            if metadata.get('Grantor'):
                grantors.add(metadata['Grantor'])
            if metadata.get('Grantee'):
                grantees.add(metadata['Grantee'])

            temp_prserv = str(uuid.uuid4())[:10]

            countyID = COUNTY_ID


           # Insert Document row
            sql_insert_doc = """
                INSERT INTO Document (PRSERV, countyID, instrumentType, fileStampDate, filingDate, legalDescription)
                VALUES (%s, %s, %s, %s, %s, %s)
            """
            cursor.execute(sql_insert_doc, (
                temp_prserv,
                countyID,
                metadata.get('instrumentType', ''),
                metadata.get('fileStampDate', None),
                metadata.get('fileDate', None),
                metadata.get('legalDescription', '')
            ))
            connection.commit()


            # Get generated documentID
            cursor.execute("SELECT LAST_INSERT_ID() AS last_id")
            document_id = cursor.fetchone()['last_id']
            prserv = base36_encode(document_id)

            # Update Document PRSERV with compressed code
            cursor.execute("UPDATE Document SET PRSERV = %s WHERE documentID = %s", (prserv, document_id))
            connection.commit()
            print(f"Document {filename}: inserted with documentID={document_id}, PRSERV={prserv}")

            # Insert Parties (grantors and grantees)
            sql_insert_party = """
                INSERT INTO Party (documentID, name, role, countyID)
                VALUES (%s, %s, %s, %s)
            """

            for name in grantors:
                cursor.execute(sql_insert_party, (document_id, name, 'Grantor', countyID))
            for name in grantees:
                cursor.execute(sql_insert_party, (document_id, name, 'Grantee', countyID))

            connection.commit()
            print(f"Inserted {len(grantors)} grantors and {len(grantees)} grantees for documentID {document_id}")

            # Upload file to S3
            original_file = os.path.join(folder_path, filename)
            if not os.path.isfile(original_file):
                print(f"ERROR: Document file not found: {original_file}")
                continue

            _, ext = os.path.splitext(original_file)
            s3_key = f"{BASE_S3_DIR}{prserv}{ext}"
            upload_to_s3(original_file, bucket_name, s3_key)


# --- ENTRY POINT ---

def main():
    connection = pymysql.connect(**DB_CONFIG)
    try:
        for foldername in os.listdir(BASE_DIR):
            folder_path = os.path.join(BASE_DIR, foldername)
            if os.path.isdir(folder_path):
                try:
                    process_folder(folder_path, connection, S3_BUCKET)
                except Exception as e:
                    print(f"Error processing folder {foldername}: {e}")
    finally:
        connection.close()

if __name__ == "__main__":
    main()
