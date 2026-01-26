import argparse
import boto3
import pymysql
from botocore.exceptions import ClientError
import os

# === CONFIGURATION ===
DB_HOST = ''
DB_NAME = ''
DB_USER = ''
DB_PASSWORD = ''

S3_BUCKET = ''
AWS_REGION = ''


def get_unique_prserv_values_by_county(county_id):
    query = "SELECT DISTINCT prserv FROM Document WHERE prserv IS NOT NULL AND countyID = %s"
    conn = None
    prserv_values = set()

    try:
        conn = pymysql.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME,
            cursorclass=pymysql.cursors.Cursor
        )
        with conn.cursor() as cur:
            cur.execute(query, (county_id,))
            rows = cur.fetchall()
            prserv_values = {row[0] for row in rows}
    except Exception as e:
        print(f"Error querying database: {e}")
    finally:
        if conn:
            conn.close()
    return prserv_values


def list_s3_files(s3_client, prefix):
    paginator = s3_client.get_paginator('list_objects_v2')
    page_iterator = paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix)

    s3_files = set()
    for page in page_iterator:
        if 'Contents' in page:
            for obj in page['Contents']:
                s3_files.add(obj['Key'])
    return s3_files


def delete_s3_files(s3_client, keys_to_delete, dry_run=True):
    if not keys_to_delete:
        print("No files to delete.")
        return

    if dry_run:
        print("Dry-run mode enabled. The following files would be deleted:")
        for key in keys_to_delete:
            print(f"  {key}")
        print(f"Total files that would be deleted: {len(keys_to_delete)}")
        return

    chunk_size = 1000
    keys_list = list(keys_to_delete)
    for i in range(0, len(keys_list), chunk_size):
        chunk = keys_list[i:i + chunk_size]
        delete_request = {'Objects': [{'Key': k} for k in chunk]}
        try:
            response = s3_client.delete_objects(Bucket=S3_BUCKET, Delete=delete_request)
            deleted = response.get('Deleted', [])
            print(f"Deleted {len(deleted)} files.")
        except ClientError as e:
            print(f"Error deleting files: {e}")

def main(county_id, s3_prefix, dry_run):
    print(f"Getting unique prserv values for countyID={county_id}...")
    prserv_values = get_unique_prserv_values_by_county(county_id)
    print(f"Found {len(prserv_values)} unique prserv values.")

    print(f"Listing all files in S3 bucket under prefix '{s3_prefix}'...")
    s3_client = boto3.client('s3', region_name=AWS_REGION)
    s3_files = list_s3_files(s3_client, s3_prefix)
    print(f"Found {len(s3_files)} files in S3 bucket under prefix.")

    s3_filenames = {
        os.path.splitext(key[len(s3_prefix):])[0]
        for key in s3_files
    }

    unlinked_filenames = s3_filenames - prserv_values

    unlinked_keys = set()
    for key in s3_files:
        base_name = os.path.splitext(key[len(s3_prefix):])[0]
        if base_name in unlinked_filenames:
            unlinked_keys.add(key)

    print(f"{len(unlinked_keys)} files are unlinked and will be {'listed (dry-run)' if dry_run else 'deleted'}.")
    delete_s3_files(s3_client, unlinked_keys, dry_run=dry_run)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Delete unlinked S3 files for a given countyID and prefix.")
    parser.add_argument("--county", type=int, required=True, help="County ID to filter prserv values")
    parser.add_argument("--prefix", type=str, required=True, help="S3 prefix (folder) to check in the bucket")
    parser.add_argument("--dry-run", action="store_true", help="Run without deleting, just list files that would be deleted")

    args = parser.parse_args()

    main(args.county, args.prefix, args.dry_run)