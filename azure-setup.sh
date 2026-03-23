#!/bin/bash
# ============================================================
# Exam Translator — Azure Initial Setup
# Ejecutar UNA VEZ antes del primer deploy
# Requiere: az CLI instalado y `az login` hecho
# ============================================================

set -e

# ── Configuración — EDITA ESTO ───────────────────────────────
RESOURCE_GROUP="exam-translator-rg"
LOCATION="eastus"                          # o centralus, westus2
ACR_NAME="examtranslatoracr"               # debe ser único globalmente
APP_NAME="exam-translator-api"
STATIC_APP_NAME="exam-translator-ui"
APP_SERVICE_PLAN="exam-translator-plan"
# ────────────────────────────────────────────────────────────

echo "🔧 Creando Resource Group..."
az group create --name $RESOURCE_GROUP --location $LOCATION

echo "📦 Creando Azure Container Registry (ACR)..."
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled true

echo "📋 Creando App Service Plan (B1 Linux)..."
az appservice plan create \
  --name $APP_SERVICE_PLAN \
  --resource-group $RESOURCE_GROUP \
  --sku B1 \
  --is-linux

echo "🚀 Creando Web App (Backend)..."
ACR_SERVER="$ACR_NAME.azurecr.io"
ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query passwords[0].value -o tsv)

az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan $APP_SERVICE_PLAN \
  --name $APP_NAME \
  --deployment-container-image-name "$ACR_SERVER/exam-translator-backend:latest"

echo "🔐 Configurando credenciales del ACR en la Web App..."
az webapp config container set \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --docker-registry-server-url "https://$ACR_SERVER" \
  --docker-registry-server-user $ACR_NAME \
  --docker-registry-server-password "$ACR_PASSWORD"

echo "⚙️  Configurando variables de entorno en el backend..."
# ⚠️  Reemplaza los valores reales aquí o configúralos después en el portal
az webapp config appsettings set \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --settings \
    DATABASE_URL="sqlite:////app/data/exam_translator.db" \
    OPENAI_API_KEY="REEMPLAZAR" \
    ANTHROPIC_API_KEY="REEMPLAZAR" \
    WEBSITES_PORT=8000

echo "🌐 Creando Static Web App (Frontend)..."
az staticwebapp create \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --location "eastus2" \
  --sku Free

echo ""
echo "✅ ¡Infraestructura creada!"
echo ""
echo "📌 Próximos pasos:"
echo "   1. Actualiza los API keys en el portal de Azure (App Service → Configuration)"
echo "   2. Obtén el token del Static Web App:"
echo "      az staticwebapp secrets list --name $STATIC_APP_NAME --resource-group $RESOURCE_GROUP"
echo "   3. Agrega estos secrets en GitHub (Settings → Secrets):"
echo "      - AZURE_CREDENTIALS  (service principal JSON)"
echo "      - AZURE_STATIC_WEB_APPS_API_TOKEN  (del paso 2)"
echo ""
echo "   Para crear AZURE_CREDENTIALS (service principal):"
echo "   az ad sp create-for-rbac --name exam-translator-sp --role contributor \\"
echo "     --scopes /subscriptions/<SUB_ID>/resourceGroups/$RESOURCE_GROUP \\"
echo "     --sdk-auth"
echo ""
echo "🔗 Web App URL: https://$APP_NAME.azurewebsites.net"
echo "🔗 Frontend URL: (se genera tras primer deploy, revisa portal)"
