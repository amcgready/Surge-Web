#!/bin/bash

# Email Verification Test Script
# This script tests the complete email verification flow

echo "🧪 Surge Email Verification Test Suite"
echo "======================================"

API_BASE="http://localhost:5001/api"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Global variables
TIMESTAMP=$(date +%s)
USERNAME="testuser$TIMESTAMP"
EMAIL="test$TIMESTAMP@example.com"

# Test functions
test_health() {
    echo -e "\n${BLUE}Testing health endpoint...${NC}"
    response=$(curl -s "$API_BASE/health")
    if [[ $response == *"healthy"* ]]; then
        echo -e "${GREEN}✓ Server is healthy${NC}"
        return 0
    else
        echo -e "${RED}✗ Server health check failed${NC}"
        return 1
    fi
}

test_registration() {
    echo -e "\n${BLUE}Testing user registration...${NC}"
    # Use timestamp to create unique username
    TIMESTAMP=$(date +%s)
    USERNAME="testuser$TIMESTAMP"
    EMAIL="test$TIMESTAMP@example.com"
    
    response=$(curl -s -X POST "$API_BASE/auth/register" \
        -H "Content-Type: application/json" \
        -d "{\"username\": \"$USERNAME\", \"email\": \"$EMAIL\", \"password\": \"TestPassword123!\"}")
    
    if [[ $response == *"success"* ]]; then
        echo -e "${GREEN}✓ Registration successful${NC}"
        echo "Response: $response"
        return 0
    else
        echo -e "${RED}✗ Registration failed${NC}"
        echo "Response: $response"
        return 1
    fi
}

test_login_unverified() {
    echo -e "\n${BLUE}Testing login with unverified email...${NC}"
    response=$(curl -s -X POST "$API_BASE/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\": \"$USERNAME\", \"password\": \"TestPassword123!\"}")
    
    if [[ $response == *"verify your email"* ]]; then
        echo -e "${GREEN}✓ Login correctly blocked for unverified user${NC}"
        return 0
    else
        echo -e "${RED}✗ Login should be blocked for unverified user${NC}"
        echo "Response: $response"
        return 1
    fi
}

test_verified_user_login() {
    echo -e "\n${BLUE}Testing login with pre-verified user...${NC}"
    response=$(curl -s -X POST "$API_BASE/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"username": "testuser", "password": "TestPassword123!"}')
    
    if [[ $response == *"token"* ]] && [[ $response == *"success"* ]]; then
        echo -e "${GREEN}✓ Pre-verified user can log in${NC}"
        return 0
    else
        echo -e "${RED}✗ Pre-verified user login failed${NC}"
        echo "Response: $response"
        return 1
    fi
}

test_resend_verification() {
    echo -e "\n${BLUE}Testing resend verification...${NC}"
    response=$(curl -s -X POST "$API_BASE/auth/resend-verification" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"$EMAIL\"}")
    
    if [[ $response == *"success"* ]]; then
        echo -e "${GREEN}✓ Resend verification works${NC}"
        return 0
    else
        echo -e "${RED}✗ Resend verification failed${NC}"
        echo "Response: $response"
        return 1
    fi
}

test_invalid_verification() {
    echo -e "\n${BLUE}Testing invalid verification token...${NC}"
    response=$(curl -s -X POST "$API_BASE/auth/verify-email" \
        -H "Content-Type: application/json" \
        -d '{"token": "invalid-token-123"}')
    
    if [[ $response == *"Invalid"* ]]; then
        echo -e "${GREEN}✓ Invalid token correctly rejected${NC}"
        return 0
    else
        echo -e "${RED}✗ Invalid token should be rejected${NC}"
        echo "Response: $response"
        return 1
    fi
}

# Run tests
echo "Starting tests..."

if ! test_health; then
    echo -e "\n${RED}Server is not running. Please start the backend server first.${NC}"
    echo "Run: cd backend && FLASK_ENV=development python app.py"
    exit 1
fi

passed=0
total=5

test_registration && ((passed++))
test_login_unverified && ((passed++))
test_verified_user_login && ((passed++))
test_resend_verification && ((passed++))
test_invalid_verification && ((passed++))

echo -e "\n======================================"
echo -e "Test Results: ${passed}/${total} tests passed"

if [ $passed -eq $total ]; then
    echo -e "${GREEN}🎉 All tests passed! Email verification is working correctly.${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Please check the implementation.${NC}"
    exit 1
fi