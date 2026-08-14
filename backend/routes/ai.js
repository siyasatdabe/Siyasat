import express from 'express';
import OpenAI from 'openai';

const router = express.Router();

// Initialize OpenAI client using Groq's 100% free cloud API
const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1'
});

router.post('/api/analyze-gaps', async (req, res) => {
    try {
        const { title, abstract, department, keywords } = req.body;

        if (!title && !abstract) {
            return res.status(400).json({
                success: false,
                message: 'Thesis title or abstract is required for AI gap analysis.'
            });
        }

        // System prompt specifically updated to return a valid JSON object holding a "gaps" array
        const systemPrompt = `
You are an expert academic research advisor specializing in Agricultural and Biosystems Engineering (ABE).
Analyze the provided thesis details and identify 4 to 5 distinct, highly practical research gaps or recommendations for future study.

OUTPUT FORMAT INSTRUCTION:
Return your response STRICTLY as a JSON object with a single root key named "gaps" containing an array of gap objects.
Example output format:
{
  "gaps": [
    {
      "id": 1,
      "title": "Short 5-8 word summary of the gap",
      "desc": "2-3 sentences explaining the research gap and why further study is needed."
    }
  ]
}

Do not include any text, markdown formatting, or markdown code blocks outside of the JSON object.
`;

        const userPrompt = `
Thesis Title: ${title || 'N/A'}
Department/Branch: ${department || 'N/A'}
Keywords: ${keywords || 'N/A'}
Abstract: ${abstract || 'N/A'}
`;

        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.5,
            response_format: { type: 'json_object' }
        });

        const rawContent = response.choices[0].message.content.trim();
        let parsedData;

        try {
            parsedData = JSON.parse(rawContent);
        } catch (parseError) {
            console.error('Failed to parse AI JSON output:', rawContent);
            return res.status(500).json({
                success: false,
                message: 'AI returned malformed JSON response.'
            });
        }

        // Safely extract array regardless of key variations
        const gaps = Array.isArray(parsedData)
            ? parsedData
            : (parsedData.gaps || parsedData.research_gaps || []);

        return res.json({ success: true, gaps });

    } catch (error) {
        console.error('AI Gap Analysis Error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate AI gap analysis.',
            error: error.message
        });
    }
});

export default router;