#!/bin/bash
SESSION=$(cat .clerk_session)
BYPASS=$(cat .vercel_bypass)

docker run --rm -v $(pwd):/zap/wrk/:rw -t zaproxy/zap-stable zap-baseline.py \
  -t https://fine-grain-access-control-3qlqporfm-kenyesh-gmailcoms-projects.vercel.app \
  -z "-config replacer.full_list(0).description=vercel -config replacer.full_list(0).enabled=true -config replacer.full_list(0).matchtype=req_header -config replacer.full_list(0).matchstr=x-vercel-protection-bypass -config replacer.full_list(0).regex=false -config replacer.full_list(0).replacement=${BYPASS} -config replacer.full_list(1).description=clerk -config replacer.full_list(1).enabled=true -config replacer.full_list(1).matchtype=req_header -config replacer.full_list(1).matchstr=Cookie -config replacer.full_list(1).regex=false -config replacer.full_list(1).replacement=\"__session=${SESSION}\"" \
  -r zap_report.html
