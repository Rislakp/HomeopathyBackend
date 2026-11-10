output "cloudfront_distribution_id" {
  description = "The ID of the CloudFront distribution"
  value       = aws_cloudfront_distribution.media_cdn.id
}

output "cloudfront_domain_name" {
  description = "The default distribution domain name (e.g. d123456abcdef8.cloudfront.net)"
  value       = aws_cloudfront_distribution.media_cdn.domain_name
}

output "cloudfront_public_key_id" {
  description = "The ID of the CloudFront public key (Set this as CLOUDFRONT_KEY_PAIR_ID in backend .env)"
  value       = aws_cloudfront_public_key.playback_key.id
}

output "cloudfront_key_group_id" {
  description = "The ID of the CloudFront key group"
  value       = aws_cloudfront_key_group.playback_keygroup.id
}

output "s3_bucket_policy_statement_json" {
  description = "The exact IAM policy statement JSON to merge into your existing S3 Bucket Policy in the AWS Console without overwriting existing statements."
  value       = data.aws_iam_policy_document.s3_oac_read.json
}

output "backend_env_instructions" {
  description = "Summary of environment variables to add to Render / backend .env"
  value = <<EOT
Add the following to your backend environment variables:
CLOUDFRONT_ENABLED=true
CLOUDFRONT_DOMAIN=${var.domain_name != "" && var.acm_certificate_arn != "" ? var.domain_name : aws_cloudfront_distribution.media_cdn.domain_name}
CLOUDFRONT_KEY_PAIR_ID=${aws_cloudfront_public_key.playback_key.id}
CLOUDFRONT_PRIVATE_KEY="<contents of cloudfront_private.pem with \n or use base64>"
EOT
}

