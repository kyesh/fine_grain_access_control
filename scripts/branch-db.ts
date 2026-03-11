/* eslint-disable */
import { createApiClient } from '@neondatabase/api-client'
import { config } from 'dotenv'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// Load environment variables from .env.local
config({ path: '.env.local' })

const NEON_API_KEY = process.env.NEON_API_KEY

if (!NEON_API_KEY) {
  console.error('❌ Error: NEON_API_KEY is missing from .env.local')
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
}

const apiClient = createApiClient({
  apiKey: NEON_API_KEY,
})

async function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
  } catch {
    console.error('❌ Error: Not a git repository or git is not installed.')
    process.exit(1)
  }
}

async function updateEnvLocal(connectionString: string) {
  const envPath = path.join(process.cwd(), '.env.local')
  let envContent = ''

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8')
  }

  // Regex to remove old DATABASE_URL or neon__POSTGRES_URL
  const regexDropDbUrl = /^DATABASE_URL=.*$/gm
  const regexDropNeonUrl = /^neon__POSTGRES_URL=.*$/gm
  const regexDropProvider = /^DB_PROVIDER=.*$/gm
  const regexDropPrisma = /^POSTGRES_PRISMA_URL=.*$/gm
  const regexDropUrlNonPooling = /^POSTGRES_URL_NON_POOLING=.*$/gm
  const regexDropUrlNoSsl = /^POSTGRES_URL_NO_SSL=.*$/gm
  const regexDropUrl = /^POSTGRES_URL=.*$/gm
  
  envContent = envContent.replace(regexDropDbUrl, '')
  envContent = envContent.replace(regexDropNeonUrl, '')
  envContent = envContent.replace(regexDropProvider, '')
  envContent = envContent.replace(regexDropPrisma, '')
  envContent = envContent.replace(regexDropUrlNonPooling, '')
  envContent = envContent.replace(regexDropUrlNoSsl, '')
  envContent = envContent.replace(regexDropUrl, '')

  const newEntry = `neon__POSTGRES_URL="${connectionString}"\nDB_PROVIDER="neon"`
  envContent += `\n${newEntry}\n`

  fs.writeFileSync(envPath, envContent.replace(/\n\n+/g, '\n'))
  console.log('✅ Updated .env.local with new neon__POSTGRES_URL')
}

async function main() {
  const gitBranch = await getGitBranch()
  const branchName = gitBranch.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() // Sanitize for Neon

  if (branchName === 'main') {
    const readline = await import('readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    console.error(
      '\n🚨 FATAL: You are attempting to run an operation against the PRODUCTION database!',
    )
    console.error(
      'Wait, should this be running on an isolated branch, or the live production database?',
    )
    console.error('Did you forget to run `npm run db:branch` first?\n')

    await new Promise<void>((resolve, reject) => {
      rl.question(
        `Type 'prod please' to confirm you intend to modify production, or 'thanks I need a branch' to safely abort.\n> `,
        (answer) => {
          rl.close()
          if (answer.trim() === 'prod please') {
            console.warn('\n⚠️  Proceeding to fetch PRODUCTION database credentials...')
            resolve()
          } else {
            console.error(
              '\n🛑 Aborted. Please switch to a non-main git branch to get a safe connection string.',
            )
            process.exit(1)
          }
        },
      )
    })
  }

  console.log(`🚀 Preparing Neon database branch for: ${branchName}`)

  try {
    // 1. Get Project ID from existing env if possible
    let projectId: string | undefined = process.env.NEON_PROJECT_ID
    let projectsResponse

    try {
      if (!projectId) {
        projectsResponse = await apiClient.listProjects({})
      }
    } catch (e: any) {
      if (e.response?.data?.message?.includes('org_id')) {
        console.log('⚠️  Organization ID required. Fetching organizations...')
        try {
          const orgs = await apiClient.getCurrentUserOrganizations()
          const organizations = orgs.data?.organizations ?? []

          if (organizations.length > 0) {
            const orgId = organizations[0].id
            console.log(`Using Organization: ${organizations[0].name} (${orgId})`)
            projectsResponse = await apiClient.listProjects({ org_id: orgId })
          } else {
            throw new Error('No organizations found.')
          }
        } catch (orgError: any) {
          console.error(
            '❌ Error: Could not list organizations or projects.',
            orgError?.message || orgError,
          )
          process.exit(1)
        }
      } else {
        throw e
      }
    }
    
    if (!projectId) {
      if (!projectsResponse || projectsResponse.data.projects.length === 0) {
        console.error('❌ Error: No Neon projects found.')
        process.exit(1)
      }
      const project = projectsResponse.data.projects[0]
      projectId = project.id
    }

    console.log(`Using project ID: ${projectId}`)

    // 2. Check if branch exists
    const branches = await apiClient.listProjectBranches({ projectId })
    let neonBranch = branches.data.branches.find((b) => b.name === branchName)

    if (!neonBranch) {
      console.log(`🌿 Branch '${branchName}' not found. Creating from 'main'...`)

      const mainBranch = branches.data.branches.find((b) => b.name === 'main' || b.primary)
      if (!mainBranch) {
        console.error('❌ Error: Could not find primary/main branch to fork from.')
        process.exit(1)
      }

      const createResponse = await apiClient.createProjectBranch(projectId, {
        branch: {
          name: branchName,
          parent_id: mainBranch.id,
        },
      })
      neonBranch = createResponse.data.branch
      console.log(`✅ Created branch '${branchName}'`)
    } else {
      console.log(`🌿 Branch '${branchName}' already exists.`)
    }

    // 3. Get Connection String
    let endpoints
    let roles
    const maxRetries = 5

    for (let i = 0; i < maxRetries; i++) {
      console.log(`⏳ Waiting for branch endpoints... (${i + 1}/${maxRetries})`)
      endpoints = await apiClient.listProjectBranchEndpoints(projectId, neonBranch.id)
      roles = await apiClient.listProjectBranchRoles(projectId, neonBranch.id)

      if (endpoints.data.endpoints.length > 0) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    if (!endpoints || endpoints.data.endpoints.length === 0) {
      console.log('⚠️  No endpoint found. Creating one...')
      try {
        await apiClient.createProjectEndpoint(projectId, {
          endpoint: {
            branch_id: neonBranch.id,
            type: 'read_write' as any,
          },
        })
        await new Promise((resolve) => setTimeout(resolve, 2000))
        endpoints = await apiClient.listProjectBranchEndpoints(projectId, neonBranch.id)
      } catch (createError) {
        console.error('❌ Error: Could not create endpoint.', createError)
      }
    }

    if (!roles || roles.data.roles.length === 0) {
      roles = await apiClient.listProjectBranchRoles(projectId, neonBranch.id)
    }

    if (!endpoints || endpoints.data.endpoints.length === 0) {
      console.error('❌ Error: Still no endpoints found for this branch.')
      process.exit(1)
    }

    const endpointHost = endpoints.data.endpoints[0].host
    const firstRole = roles.data.roles[0]
    const roleName = firstRole.name
    const dbName = 'neondb'

    const rolePasswordResponse = await apiClient.getProjectBranchRolePassword(
      projectId,
      neonBranch.id,
      roleName,
    )
    const password = rolePasswordResponse.data.password
    const connectionString = `postgresql://${roleName}:${password}@${endpointHost}/${dbName}?sslmode=require`

    await updateEnvLocal(connectionString)
    console.log(`🎉 Ready! Local environment connected to branch: ${branchName}`)
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

main()
