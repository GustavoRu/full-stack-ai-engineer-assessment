variable "project" {
  description = "Name used as a prefix for every resource"
  type        = string
  default     = "docqa"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "api_image" {
  description = "Full image reference of the API, including the tag"
  type        = string
}

variable "web_image" {
  description = "Full image reference of the frontend, built with NEXT_PUBLIC_API_URL=/api"
  type        = string
}

variable "cpu_architecture" {
  description = "Must match the platform the images were built for"
  type        = string
  default     = "ARM64"
}

variable "api_min_count" {
  type    = number
  default = 1
}

variable "api_max_count" {
  type    = number
  default = 4
}

variable "requests_per_task_target" {
  description = "Requests per minute one API task should handle before another is added"
  type        = number
  default     = 60
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "alert_email" {
  description = "Address that receives alarm notifications. The default is a placeholder: set a real one"
  type        = string
  default     = "oncall@example.com"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

# Model configuration: changing these needs no new image
variable "llm_provider" {
  type    = string
  default = "gemini"
}

variable "gemini_chat_model" {
  type    = string
  default = "gemini-3.1-flash-lite"
}

variable "gemini_embedding_model" {
  type    = string
  default = "gemini-embedding-001"
}

variable "prompt_version" {
  type    = string
  default = "qa-v1"
}

variable "api_limits" {
  description = "Limits passed to the API as environment variables"
  type        = map(string)
  default = {
    MAX_UPLOAD_BYTES   = "5242880"
    MAX_DOCUMENT_CHARS = "50000"
    MAX_QUESTION_CHARS = "1000"
    RETRIEVAL_TOP_K    = "5"
    MAX_OUTPUT_TOKENS  = "800"
  }
}
