use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct ModelPrice {
    /// Cost per 1,000,000 input tokens in USD
    pub input_per_million: f64,
    /// Cost per 1,000,000 output tokens in USD
    pub output_per_million: f64,
    /// Cost per 1,000,000 cached read tokens in USD
    pub cache_read_per_million: f64,
}

pub struct CostEngine {
    prices: HashMap<String, ModelPrice>,
}

impl Default for CostEngine {
    fn default() -> Self {
        let mut prices = HashMap::new();

        // Claude Models
        prices.insert(
            "claude-3-7-sonnet".into(),
            ModelPrice {
                input_per_million: 3.0,
                output_per_million: 15.0,
                cache_read_per_million: 0.30,
            },
        );
        prices.insert(
            "claude-3-5-sonnet".into(),
            ModelPrice {
                input_per_million: 3.0,
                output_per_million: 15.0,
                cache_read_per_million: 0.30,
            },
        );
        prices.insert(
            "claude-3-5-haiku".into(),
            ModelPrice {
                input_per_million: 0.80,
                output_per_million: 4.0,
                cache_read_per_million: 0.08,
            },
        );
        prices.insert(
            "claude-3-opus".into(),
            ModelPrice {
                input_per_million: 15.0,
                output_per_million: 75.0,
                cache_read_per_million: 1.50,
            },
        );

        // Gemini / Antigravity Models
        prices.insert(
            "gemini-3.8-flash".into(),
            ModelPrice {
                input_per_million: 0.15,
                output_per_million: 0.60,
                cache_read_per_million: 0.0375,
            },
        );
        prices.insert(
            "gemini-3.7-flash".into(),
            ModelPrice {
                input_per_million: 0.15,
                output_per_million: 0.60,
                cache_read_per_million: 0.0375,
            },
        );
        prices.insert(
            "gemini-3.6-flash".into(),
            ModelPrice {
                input_per_million: 0.10,
                output_per_million: 0.40,
                cache_read_per_million: 0.025,
            },
        );
        prices.insert(
            "gemini-3.1-pro".into(),
            ModelPrice {
                input_per_million: 1.25,
                output_per_million: 5.00,
                cache_read_per_million: 0.3125,
            },
        );
        prices.insert(
            "claude-sonnet-4-6".into(),
            ModelPrice {
                input_per_million: 3.0,
                output_per_million: 15.0,
                cache_read_per_million: 0.30,
            },
        );
        prices.insert(
            "claude-opus-4-6".into(),
            ModelPrice {
                input_per_million: 15.0,
                output_per_million: 75.0,
                cache_read_per_million: 1.50,
            },
        );
        prices.insert(
            "gpt-oss-120b".into(),
            ModelPrice {
                input_per_million: 0.20,
                output_per_million: 0.80,
                cache_read_per_million: 0.05,
            },
        );

        // OpenAI Models
        prices.insert(
            "gpt-4o".into(),
            ModelPrice {
                input_per_million: 2.50,
                output_per_million: 10.00,
                cache_read_per_million: 1.25,
            },
        );
        prices.insert(
            "gpt-4o-mini".into(),
            ModelPrice {
                input_per_million: 0.15,
                output_per_million: 0.60,
                cache_read_per_million: 0.075,
            },
        );

        // DeepSeek
        prices.insert(
            "deepseek-chat".into(),
            ModelPrice {
                input_per_million: 0.14,
                output_per_million: 0.28,
                cache_read_per_million: 0.014,
            },
        );
        prices.insert(
            "deepseek-reasoner".into(),
            ModelPrice {
                input_per_million: 0.55,
                output_per_million: 2.19,
                cache_read_per_million: 0.14,
            },
        );

        Self { prices }
    }
}

impl CostEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn calculate_cost_usd(
        &self,
        model: &str,
        input_tokens: u64,
        output_tokens: u64,
        cached_tokens: u64,
    ) -> f64 {
        let normalized = model.to_lowercase();
        let price = self
            .prices
            .iter()
            .find(|(k, _)| normalized.contains(*k))
            .map(|(_, p)| p)
            .cloned()
            .unwrap_or(ModelPrice {
                input_per_million: 1.0,
                output_per_million: 3.0,
                cache_read_per_million: 0.2,
            });

        let in_cost = (input_tokens as f64 / 1_000_000.0) * price.input_per_million;
        let out_cost = (output_tokens as f64 / 1_000_000.0) * price.output_per_million;
        let cache_cost = (cached_tokens as f64 / 1_000_000.0) * price.cache_read_per_million;

        in_cost + out_cost + cache_cost
    }
}
