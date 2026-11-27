#!/usr/bin/env python3
"""Analyze the d1_storage.db to identify affected Delivery Orders."""

import sqlite3
import json
import os
import sys

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'd1_storage.db')

def analyze_database():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    print("=" * 80)
    print("DATABASE ANALYSIS: d1_storage.db")
    print("=" * 80)

    # List all tables
    print("\n[1] TABLES IN DATABASE:")
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [row[0] for row in cur.fetchall()]
    for t in tables:
        print(f"   - {t}")

    # Check delivery_orders table
    if 'delivery_orders' in tables:
        print("\n[2] delivery_orders TABLE:")
        cur.execute("PRAGMA table_info(delivery_orders)")
        columns = [row[1] for row in cur.fetchall()]
        print(f"   Columns: {columns}")

        # Count statuses
        cur.execute("SELECT status, COUNT(*) as cnt FROM delivery_orders GROUP BY status")
        status_counts = cur.fetchall()
        print("   Status distribution:")
        for row in status_counts:
            print(f"      {row['status']}: {row['cnt']}")

        # Get recent delivery orders
        cur.execute("SELECT id, delivery_no, sale_id, invoice_no, status, is_pickup_confirmed, updated_at FROM delivery_orders ORDER BY created_at DESC LIMIT 20")
        rows = cur.fetchall()
        print("   Recent delivery orders:")
        for row in rows:
            print(f"      {row['id']} | {row['delivery_no']} | sale={row['sale_id']} | inv={row['invoice_no']} | status={row['status']} | pickup_confirmed={row['is_pickup_confirmed']} | updated={row['updated_at']}")

    # Check sales table
    if 'sales' in tables:
        print("\n[3] sales TABLE:")
        cur.execute("PRAGMA table_info(sales)")
        columns = [row[1] for row in cur.fetchall()]
        print(f"   Columns: {columns}")

        cur.execute("SELECT id, invoice_no, status, delivery_fee, is_historical, created_at FROM sales ORDER BY created_at DESC LIMIT 20")
        rows = cur.fetchall()
        print("   Recent sales:")
        for row in rows:
            print(f"      {row['id']} | {row['invoice_no']} | status={row['status']} | fee={row['delivery_fee']} | historical={row['is_historical']} | created={row['created_at']}")

    # Check audit_logs table
    if 'audit_logs' in tables:
        print("\n[4] audit_logs TABLE:")
        cur.execute("PRAGMA table_info(audit_logs)")
        columns = [row[1] for row in cur.fetchall()]
        print(f"   Columns: {columns}")

        # Find delivery-related audit actions
        cur.execute("SELECT DISTINCT action FROM audit_logs WHERE action LIKE '%delivery%' OR action LIKE '%Delivery%' ORDER BY action")
        actions = cur.fetchall()
        print("   Delivery-related actions:")
        for row in actions:
            print(f"      - {row['action']}")

        # Count key delivery actions
        cur.execute("SELECT action, COUNT(*) as cnt FROM audit_logs WHERE action IN ('CREATE_DELIVERY_ORDER', 'CONFIRM_DELIVERY_PICKUP', 'UPDATE_DELIVERY_STATUS') GROUP BY action")
        counts = cur.fetchall()
        print("   Delivery action counts:")
        for row in counts:
            print(f"      {row['action']}: {row['cnt']}")

    conn.close()

if __name__ == '__main__':
    analyze_database()
