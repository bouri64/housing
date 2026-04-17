from flask import Flask, request, jsonify
from dotenv import load_dotenv
import os
from groq import Groq

load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

app = Flask(__name__)

def req_groq(prompt, model="openai/gpt-oss-120b"):
    client = Groq(api_key=GROQ_API_KEY)
    completion = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0
    )
    return completion

def parse_groq(match_text: str, base: str, model="openai/gpt-oss-120b"):
    if base == "":
        base = "## Output format: [year,amount] ... ## Context:\n"

    prompt = base + match_text + "##"

    completion = req_groq(prompt, model)

    return {
        "original_text": match_text,
        "response": completion.choices[0].message.content,
        "length": len(prompt)
    }

@app.route("/groq", methods=["POST"])
def groq_endpoint():
    data = request.json

    result = parse_groq(
        data.get("match_text", ""),
        data.get("base", ""),
        data.get("model", "openai/gpt-oss-120b")
    )

    return jsonify(result)

if __name__ == "__main__":
    app.run(port=5000)