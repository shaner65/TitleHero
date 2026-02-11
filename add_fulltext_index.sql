-- Add FULLTEXT index for optimized "Search All Fields" functionality
-- This index dramatically improves performance for criteria searches
-- Run this script on your production database to fix 503 timeout errors

-- Check if the index already exists before creating it
SET @index_exists = (
    SELECT COUNT(1) 
    FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE table_schema = DATABASE() 
    AND table_name = 'Document' 
    AND index_name = 'ft_document_search'
);

-- Create the FULLTEXT index if it doesn't exist
SET @create_index_sql = IF(
    @index_exists = 0,
    'CREATE FULLTEXT INDEX ft_document_search ON Document(
        instrumentNumber, 
        instrumentType, 
        legalDescription, 
        remarks, 
        address,
        CADNumber, 
        CADNumber2, 
        book, 
        volume, 
        page, 
        abstractText, 
        fieldNotes
    )',
    'SELECT "FULLTEXT index already exists" AS message'
);

PREPARE stmt FROM @create_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify the index was created
SELECT 
    INDEX_NAME as 'Index Name',
    INDEX_TYPE as 'Index Type',
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as 'Columns'
FROM INFORMATION_SCHEMA.STATISTICS
WHERE table_schema = DATABASE()
AND table_name = 'Document'
AND INDEX_NAME = 'ft_document_search'
GROUP BY INDEX_NAME, INDEX_TYPE;

-- Show table status
SELECT 
    'Document' as 'Table',
    TABLE_ROWS as 'Approx Rows',
    ROUND(DATA_LENGTH / 1024 / 1024, 2) as 'Data Size (MB)',
    ROUND(INDEX_LENGTH / 1024 / 1024, 2) as 'Index Size (MB)'
FROM INFORMATION_SCHEMA.TABLES
WHERE table_schema = DATABASE()
AND table_name = 'Document';
