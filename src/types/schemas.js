const { z } = require('zod');

// Base subscription schema
const SubscriptionSchema = z.object({
  subscription_id: z.string().uuid(),
  user_id: z.string().uuid(),
  type_name: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  prompts: z.array(z.string()).or(z.string()).optional(),
  frequency: z.enum(['immediate', 'daily']).default('daily'),
  metadata: z.object({
    prompts: z.array(z.string()).optional(),
    texts: z.array(z.string()).optional(),
  }).optional(),
  texts: z.array(z.string()).optional(),
  status: z.enum(['active', 'paused', 'deleted']).optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
}).passthrough();

// Processor result schema
const ProcessorResultSchema = z.object({
  status: z.enum(['success', 'error']),
  timestamp: z.string().datetime(),
  entries: z.array(z.any()),
  error: z.string().optional(),
  query_date: z.string().optional(),
}).passthrough();

// Subscription processing request schema
const ProcessingRequestSchema = z.object({
  subscription_id: z.string().uuid(),
  user_id: z.string().uuid().optional(),
}).passthrough();

// PubSub notification message schema
const PubSubNotificationSchema = z.object({
  version: z.string(),
  processor_type: z.string(),
  timestamp: z.string().datetime(),
  trace_id: z.string(),
  request: z.object({
    subscription_id: z.string(),
    processing_id: z.string(),
    user_id: z.string(),
    prompts: z.array(z.string()),
  }),
  results: z.object({
    query_date: z.string(),
    matches: z.array(z.object({
      prompt: z.string(),
      documents: z.array(z.object({
        document_type: z.string(),
        title: z.string(),
        summary: z.string(),
        relevance_score: z.number(),
        links: z.object({
          html: z.string().url(),
          pdf: z.string().url().optional(),
        }),
      }).passthrough()),
    })),
  }),
  metadata: z.object({
    processing_time_ms: z.number(),
    total_matches: z.number(),
    status: z.enum(['success', 'error']),
    error: z.string().nullable(),
  }),
});

// Document schemas for different processors
const BOEDocumentSchema = z.object({
  document_type: z.literal('boe_document'),
  title: z.string(),
  summary: z.string(),
  relevance_score: z.number(),
  links: z.object({
    html: z.string().url(),
    pdf: z.string().url().optional(),
  }),
  publication_date: z.string(),
  section: z.string().optional(),
  bulletin_type: z.string().optional(),
}).passthrough();

const DOGADocumentSchema = z.object({
  document_type: z.literal('doga_document'),
  title: z.string(),
  summary: z.string(),
  relevance_score: z.number(),
  links: z.object({
    html: z.string().url(),
    pdf: z.string().url().optional(),
  }),
  publication_date: z.string(),
  section: z.string().optional(),
  bulletin_type: z.string().optional(),
}).passthrough();

const RealEstateDocumentSchema = z.object({
  document_type: z.literal('real_estate_listing'),
  title: z.string(),
  summary: z.string(),
  relevance_score: z.number(),
  links: z.object({
    html: z.string().url(),
    pdf: z.string().url().optional(),
  }),
  price: z.number().optional(),
  location: z.object({
    city: z.string(),
    region: z.string().optional(),
  }).optional(),
  property_type: z.string().optional(),
}).passthrough();

module.exports = {
  SubscriptionSchema,
  ProcessorResultSchema,
  ProcessingRequestSchema,
  PubSubNotificationSchema,
  BOEDocumentSchema,
  DOGADocumentSchema,
  RealEstateDocumentSchema
};