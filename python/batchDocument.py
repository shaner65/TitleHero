import pymysql

db_config = {
    'host': '',
    'user': '',
    'password': '',
    'database': '',
    'cursorclass': pymysql.cursors.DictCursor,
    'autocommit': False,
}

BATCH_SIZE = 2000

COUNTY_ID = 0

def get_prserv_batch(cursor, offset):
    cursor.execute(f"""
        SELECT DISTINCT PRSERV FROM Prime_Staging
        ORDER BY PRSERV
        LIMIT {BATCH_SIZE} OFFSET {offset}
    """)
    return [row['PRSERV'] for row in cursor.fetchall()]

def batch_insert(offset=0):
    conn = pymysql.connect(**db_config)
    cursor = conn.cursor()

    total_inserted = 0
    try:
        while True:
            prserv_batch = get_prserv_batch(cursor, offset)
            if not prserv_batch:
                break  # no more batches

            # Prepare string list for SQL IN clause with proper escaping
            prserv_list = ",".join(cursor.connection.escape(p) for p in prserv_batch)

            insert_query = f"""
                INSERT IGNORE INTO Document (
                    PRSERV,
                    countyID,
                    volume,
                    page,
                    filingDate,
                    fileStampDate,
                    remarks,
                    legalDescription,
                    subBlock,
                    abstractID,
                    acres,
                    instrumentType,
                    clerkNumber,
                    lienAmount,
                    GFNNumber
                )
                SELECT
                    p.PRSERV,
                    {COUNTY_ID} AS countyID,
                    p.Volume,
                    p.Page,
                    p.Filing_Date,
                    p.Instrument_Date,
                    p.Remarks,
                    p.Legal_Description,
                    p.Sub_Block_Lot,
                    p.Abst_Svy,
                    p.Acres,
                    p.Book,
                    p.Clerk_Number,
                    p.Lien_Amount,
                    GF_Number
                FROM Prime_Staging p
                WHERE p.PRSERV IN ({prserv_list})
                AND NOT EXISTS (
                    SELECT 1 FROM Document d
                    WHERE d.PRSERV = p.PRSERV
                        AND d.countyID = {COUNTY_ID}
                );
            """

            cursor.execute(insert_query)
            conn.commit()
            inserted = cursor.rowcount
            print(f"Batch starting at offset {offset}: inserted {inserted} rows")
            total_inserted += inserted

            offset += BATCH_SIZE
    finally:
        cursor.close()
        conn.close()

    print(f"Batch insert complete, total inserted rows: {total_inserted}")

if __name__ == "__main__":
    batch_insert()
