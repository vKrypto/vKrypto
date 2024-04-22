import os
import asyncio
from openai import AsyncOpenAI


API_KEY = ""

client = AsyncOpenAI(
    # This is the default and can be omitted
    api_key=API_KEY,
)


async def main() -> None:
    chat_completion = await client.chat.completions.create(
        messages=[
            {
                "role": "user",
                "content": "i need to create 15 hashtags for instagram and linkedIN post for better reach, my post is about technology, python, memory management garbage collector",
            }
        ],
        model="gpt-3.5-turbo",
    )
    print(chat_completion.choices[0].message.content)


asyncio.run(main())