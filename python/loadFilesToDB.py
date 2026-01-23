import os
import pymysql
from tqdm import tqdm

# Configurable toggles:
LOAD_MODE = 'all'  # Options: 'one', 'skip_first', 'all'

PRIME_DIR = ''
MULTI_DIR = ''

PRIME_TABLE = ''
MULTI_TABLE = ''

DB_CONFIG = {
    'host': '',
    'user': '',
    'password': '',
    'database': '',
    'local_infile': True,
    'cursorclass': pymysql.cursors.DictCursor,
    'autocommit': True
}

def load_prime_file_into_table(cursor, file_path, table_name):
    sql = f"""
    LOAD DATA LOCAL INFILE '{file_path}'
    INTO TABLE {table_name}
    CHARACTER SET latin1
    FIELDS TERMINATED BY '\\t'
    LINES TERMINATED BY '\\n'
    IGNORE 1 LINES
    (
      PRSTAT,
      PRDOC,
      PRSERV,
      PRTYPE,
      PRMNAME,
      PRFOLDER,
      PRQUEUE,
      Clerk_Number,
      Book,
      Volume,
      Page,
      Grantor,
      Grantee,
      Instrument_Type,
      Remarks,
      Lien_Amount,
      Legal_Description,
      Sub_Block_Lot,
      Abst_Svy,
      @Acres,
      Appr_Dist_ID,
      GIS,
      @Instrument_Date,
      @Filing_Date,
      Prior_Reference,
      Title_Co,
      GF_Number,
      Finalized_By,
      Export_Flag
    )
    SET
      Acres = NULLIF(@Acres, ''),
      Filing_Date = STR_TO_DATE(@Filing_Date, '%Y-%m-%d'),
      Instrument_Date = STR_TO_DATE(@Instrument_Date, '%Y-%m-%d');
    """
    try:
        cursor.execute(sql)
    except Exception as e:
        print(f"Error loading file {file_path} into table {table_name}: {e}")


def load_multi_file_into_table(cursor, file_path, table_name):
    sql = f"""
    LOAD DATA LOCAL INFILE '{file_path}'
    INTO TABLE {table_name}
    CHARACTER SET latin1
    FIELDS TERMINATED BY '\\t'
    LINES TERMINATED BY '\\n'
    IGNORE 1 LINES
    (
      PRSERV,
      Number,
      Grantor,
      Grantee,
      Legal_Description,
      Sub_Block_Lot,
      Abst_Svy,
      @Acres,
      Appr_Dist_ID,
      GIS,
      Prior_Reference,
      FullTextKey
    )
    SET
      Acres = NULLIF(@Acres, '');
    """
    try:
        cursor.execute(sql)
    except Exception as e:
        print(f"Error loading file {file_path} into table {table_name}: {e}")


def filter_files(files):
    if not files:
        return []

    if LOAD_MODE == 'one':
        return [files[0]]
    elif LOAD_MODE == 'skip_first':
        return files[1:]
    elif LOAD_MODE == 'all':
        return files
    else:
        print(f"Unknown LOAD_MODE '{LOAD_MODE}', defaulting to one file.")
        return [files[0]]

def main():
    connection = pymysql.connect(**DB_CONFIG)
    cursor = connection.cursor()

    prime_files = sorted([os.path.join(PRIME_DIR, f) for f in os.listdir(PRIME_DIR) if f.endswith('_fixed.txt')])
    multi_files = sorted([os.path.join(MULTI_DIR, f) for f in os.listdir(MULTI_DIR) if f.endswith('_fixed.txt')])

    prime_files_to_load = filter_files(prime_files)
    multi_files_to_load = filter_files(multi_files)

    print(f"Prime files to load ({len(prime_files_to_load)})")
    for file in tqdm(prime_files_to_load):
        load_prime_file_into_table(cursor, file, PRIME_TABLE)

    print(f"Multi files to load ({len(multi_files_to_load)})")
    for file in tqdm(multi_files_to_load):
        load_multi_file_into_table(cursor, file, MULTI_TABLE)

    cursor.close()
    connection.close()
    print("Loading complete.")

if __name__ == '__main__':
    main()
