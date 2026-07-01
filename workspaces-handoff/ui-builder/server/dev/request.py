import requests

url = "http://192.168.178.68:80"
data = {"name": "mike", "age": 18}

response = requests.get(url, json=data)

print("Status Code:", response.status_code)
print("Response:", response.text)