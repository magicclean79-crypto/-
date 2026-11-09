#!/bin/bash
# 백업 보관 정책 — 7일 넘은 pg_dump 파일 자동 삭제 (T1-210, 디스크 포화 방지)
find /home/ec2-user/acos-data/backups -name '*.dump' -mtime +7 -delete
