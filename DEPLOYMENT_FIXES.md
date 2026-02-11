# Deployment Fixes - Action Items

## Issues Fixed

### 1. ✅ CORS Configuration (Failed to Fetch on Deployed Site)
**Problem**: Backend was rejecting requests from deployed frontend domain  
**Location**: `server/index.js`  
**Fix**: Updated CORS to allow Vercel domains and pattern matching

### 2. ✅ API Path Configuration (Production API Calls)
**Problem**: Frontend components using `/api` paths that don't work on Vercel  
**Location**: `client/src/pages/Dashboard/ResultsComponents/ChainOfTitle.tsx`, `client/src/pages/Admin.tsx`  
**Fix**: All components now use `API_BASE` from constants which correctly points to AWS backend in production

### 3. ✅ Search Performance Optimization (503 Errors & Timeouts)
**Problem**: "Search All Fields" causing 503 Service Unavailable and infinite loading  
**Location**: `server/routes/documents.js`  
**Fix**: Optimized search to use LIKE for short queries and improved FULLTEXT query structure

## Required Actions

### CRITICAL: Deploy These Changes

1. **Commit and Push Changes**
   ```bash
   git add .
   git commit -m "Fix: CORS config, API paths, and search performance"
   git push origin main
   ```

2. **Redeploy Backend on AWS**
   - SSH into your EC2 instance or use your deployment pipeline
   - Pull latest changes
   - Restart Docker containers:
     ```bash
     cd ~/TitleHero/TitleHero
     git pull
     docker-compose down
     docker-compose up -d --build
     ```

3. **Add FULLTEXT Index to Production Database**
   Run the SQL script `add_fulltext_index.sql` on your production MySQL database:
   ```bash
   mysql -h <your-rds-endpoint> -u <username> -p <database> < add_fulltext_index.sql
   ```
   
   **This is CRITICAL** - without this index, "Search All Fields" will continue to timeout on large datasets.

4. **Update Vercel Environment Variable**
   In your Vercel project settings, ensure:
   ```
   VITE_API_TARGET=https://5mj0m92f17.execute-api.us-east-2.amazonaws.com/api
   ```
   (Or update to your actual backend URL if different)

5. **Redeploy Frontend on Vercel**
   - Push changes to trigger auto-deploy, OR
   - Manually redeploy from Vercel dashboard

### Verify Fixes

After deployment, test these scenarios:

1. **Admin Panel User Fetching**
   - Navigate to Admin Panel on deployed site
   - Should load users without "Failed to fetch" error
   - Check browser console for CORS errors

2. **Chain of Title**
   - Search for a document
   - Click to view Chain of Title
   - Should load without "Failed to fetch" error

3. **Search All Fields**
   - Use the "SEARCH ALL FIELDS" textarea
   - Enter common terms (names, addresses, etc.)
   - Should return results within 2-5 seconds (not timeout)
   - Check for 503 errors

### If Issues Persist

1. **Check Backend Logs**
   ```bash
   docker logs <backend-container-name> --tail=100 -f
   ```

2. **Verify CORS Origin**
   - Check browser console for exact origin being sent
   - Add that origin to `allowedOrigins` array if needed

3. **Check Database Connection**
   ```bash
   # Test from EC2
   mysql -h <rds-endpoint> -u <user> -p
   # Run: SHOW INDEX FROM Document WHERE Key_name = 'ft_document_search';
   ```

4. **Monitor API Response Times**
   - Use browser Network tab to check actual response times
   - Queries should complete in < 5 seconds
   - If still slow, database may need optimization (ANALYZE TABLE, etc.)

## Architecture Notes

### Production Request Flow
```
User Browser (Vercel: title-hero.vercel.app)
    ↓
API_BASE = https://5mj0m92f17.execute-api.us-east-2.amazonaws.com/api
    ↓
AWS API Gateway / EC2 Backend (Node.js + Express)
    ↓
AWS RDS MySQL Database
    ↓
AWS S3 (Document Storage)
```

### Local Development Request Flow
```
User Browser (localhost:5173)
    ↓
Vite Dev Server Proxy (/api → localhost:5000)
    ↓
Local Node.js Backend (port 5000)
    ↓
Local MySQL Database
    ↓
AWS S3 (Document Storage)
```

## Code Changes Summary

### server/index.js
- Added support for Vercel deployment domains
- Added pattern matching for dynamic Vercel preview URLs
- Improved CORS error logging

### client/src/pages/Admin.tsx
- Removed duplicate API_BASE definition
- Now imports from constants

### client/src/pages/Dashboard/ResultsComponents/ChainOfTitle.tsx
- Added API_BASE import
- Updated all fetch calls to use API_BASE
- Ensures compatibility with production deployment

### server/routes/documents.js
- Optimized "criteria" search query
- Added intelligent search strategy (LIKE for short queries, FULLTEXT for long)
- Better Party table searching
- Reduced query timeout issues

## Monitoring Recommendations

After deployment, monitor:
- CloudWatch logs for backend errors
- Database slow query log
- Frontend error tracking (consider Sentry)
- API response times

## Future Improvements

1. Add query result caching (Redis) for frequent searches
2. Implement request timeout handling on frontend
3. Add retry logic for failed API calls
4. Consider database read replicas for search queries
5. Add rate limiting to prevent abuse
