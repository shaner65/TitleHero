import pymysql
from tqdm import tqdm

db_config = {
    'host': '',
    'user': '',
    'password': '',
    'database': '',
    'autocommit': False,
}

BATCH_SIZE = 5000
COUNTY_ID = 0

def get_doc_bounds():
    conn = pymysql.connect(**db_config)
    with conn.cursor() as cursor:
        cursor.execute("""
            SELECT MIN(documentID), MAX(documentID)
            FROM Document
            WHERE countyID = %s
        """, (COUNTY_ID,))
        lo, hi = cursor.fetchone()
    conn.close()
    return lo, hi

def insert_chunk(table, column, role, lo, hi):
    conn = pymysql.connect(**db_config)
    with conn.cursor() as cursor:
        cursor.execute(f"""
            INSERT IGNORE INTO Party (documentID, name, role, countyID)
            SELECT d.documentID, m.{column}, '{role}', d.countyID
            FROM Document d
            STRAIGHT_JOIN {table} m ON m.PRSERV = d.PRSERV
            LEFT JOIN Party p
              ON p.documentID = d.documentID
             AND p.name = m.{column}
             AND p.role = '{role}'
             AND p.countyID = d.countyID
            WHERE d.countyID = %s
              AND d.documentID BETWEEN %s AND %s
              AND m.{column} IS NOT NULL
              AND TRIM(m.{column}) != ''
              AND p.documentID IS NULL;
        """, (COUNTY_ID, lo, hi))
        conn.commit()
        return cursor.rowcount

def run_chunked(table, column, role):
    lo, hi = get_doc_bounds()
    total_batches = ((hi - lo) // BATCH_SIZE) + 1

    print(f"{table} {role}: documentID {lo} → {hi}")

    with tqdm(total=total_batches, desc=f"{table} {role}", unit="batch") as pbar:
        start = lo
        total_inserted = 0

        while start <= hi:
            end = start + BATCH_SIZE - 1
            inserted = insert_chunk(table, column, role, start, end)
            total_inserted += inserted
            pbar.update(1)
            pbar.set_postfix(inserted=total_inserted)
            start = end + 1

    print(f"{table} {role}: DONE ({total_inserted} rows inserted)")

def main():
    run_chunked('Multi_Staging', 'Grantor', 'Grantor')
    run_chunked('Multi_Staging', 'Grantee', 'Grantee')
    run_chunked('Prime_Staging', 'Grantor', 'Grantor')
    run_chunked('Prime_Staging', 'Grantee', 'Grantee')

if __name__ == "__main__":
    main()
