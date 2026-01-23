import pymysql
import re
import os

BASE_DIR = r''  # Set your base directory here
file_name = ''            # Your data file name
file_path = os.path.join(BASE_DIR, file_name)

DB_CONFIG = {
    'host': '',
    'user': '',
    'password': '',
    'database': '',
}

COUNTY_NAME = ""

def get_county_id(cursor, name):
    cursor.execute("SELECT countyID FROM County WHERE name = %s LIMIT 1", (name,))
    result = cursor.fetchone()
    if result:
        return result['countyID'] if isinstance(result, dict) else result[0]
    else:
        return None

def parse_abstract_data(raw, county_id):
    pattern = re.compile(r'(\d+)([^\d]+)')
    matches = pattern.findall(raw)
    result = []
    for m in matches:
        id_ = int(m[0])
        names = m[1].split('{EOR}')
        for name in names:
            name = name.strip()
            if name:
                result.append((id_, name, county_id))
    return result

# def parse_abstract_data(raw, county_id):
#     # Match: number,"Name"
#     pattern = re.compile(r'(\d+)\s*,\s*"([^"]+)"')

#     result = []
#     for id_str, name in pattern.findall(raw):
#         id_ = int(id_str)
#         name = name.strip()
#         if name:
#             result.append((id_, name, county_id))

#     return result

def insert_abstract_records(records):
    conn = pymysql.connect(**DB_CONFIG)
    cursor = conn.cursor()

    insert_sql = "INSERT IGNORE INTO Abstract (abstractCode, name, countyID) VALUES (%s, %s, %s)"

    try:
        cursor.executemany(insert_sql, records)
        conn.commit()
        print(f"Inserted {cursor.rowcount} rows into Abstract table.")
    except pymysql.MySQLError as e:
        print(f"Database error: {e}")
        conn.rollback()
    except Exception as e:
        print(f"Unexpected error: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

def main():
    with open(file_path, 'r', encoding='utf-8') as f:
        raw_data = f.read()

    conn = pymysql.connect(**DB_CONFIG)
    cursor = conn.cursor()

    county_id = get_county_id(cursor, COUNTY_NAME)
    if county_id is None:
        print(f"County '{COUNTY_NAME}' not found in database.")
        cursor.close()
        conn.close()
        return
    else:
        print(f"County '{COUNTY_NAME}' has ID: {county_id}")

    cursor.close()
    conn.close()

    records = parse_abstract_data(raw_data, county_id)
    if records:
        insert_abstract_records(records)
    else:
        print("No records found to insert.")

if __name__ == '__main__':
    main()
