variable "aws_region" {
  description = "AWS region for primary resources (CloudFront requires ACM in us-east-1)"
  type        = string
  default     = "us-east-1"
}

variable "s3_bucket_name" {
  description = "Existing S3 bucket storing media assets"
  type        = string
  default     = "whitecoat-media-prod"
}

variable "domain_name" {
  description = "Custom domain alias for the CloudFront distribution (e.g. media.whitecoat.academy)"
  type        = string
  default     = "media.whitecoat.academy"
}

variable "public_key_pem_path" {
  description = "Path to the RSA 2048-bit public key PEM file used for CloudFront URL signing"
  type        = string
  default     = "cloudfront_public.pem"
}

variable "key_pair_name" {
  description = "Name for the CloudFront public key resource"
  type        = string
  default     = "whitecoat-playback-key"
}

variable "key_group_name" {
  description = "Name for the CloudFront key group resource"
  type        = string
  default     = "whitecoat-playback-keygroup"
}

variable "cors_allowed_origins" {
  description = "List of web origins permitted to make cross-origin video requests via CloudFront"
  type        = list(string)
  default = [
    "https://student.whitecoat.academy",
    "https://student-portal.whitecoat.academy",
    "https://whitecoat.academy",
    "https://admin.whitecoat.academy",
    "http://localhost:3000",
    "http://localhost:5000",
    "http://localhost:5173",
  ]
}

variable "acm_certificate_arn" {
  description = "ARN of an existing ACM SSL certificate in us-east-1 covering the custom domain. If empty, uses cloudfront_default_certificate until cert is validated."
  type        = string
  default     = ""
}

variable "manage_s3_bucket_policy" {
  description = "Whether Terraform should directly manage/replace the S3 bucket policy resource. Set to false (default) to prevent replacing any existing S3 bucket policies on whitecoat-media-prod; you can manually add the statement outputted by Terraform."
  type        = bool
  default     = false
}

