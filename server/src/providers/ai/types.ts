import { ExpenseCategory, ClassificationSource } from '../../db/schema.js';

export interface AIClassificationResult {
  title: string | null;
  category: ExpenseCategory;
  confidence: number;
}

export interface AIProvider {
  readonly source: ClassificationSource;
  classifyExpense(description: string, recipient?: string | null, amount?: number): Promise<AIClassificationResult>;
}
