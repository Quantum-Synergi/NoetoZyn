use anchor_lang::prelude::*;

declare_id!("RfGptereRgYUVAMwGNVepysjQgJjFbrXyarXnUX7Ama");

#[program]
pub mod noetozyn {
    use super::*;

    pub fn commit_biometric_proof(
        ctx: Context<CommitBiometricProof>,
        telemetry_stream_id: [u8; 16],
        masked_state_hash: [u8; 32],
        timestamp: i64,
    ) -> Result<()> {
        let checkpoint = &mut ctx.accounts.proof_checkpoint;
        checkpoint.guardian_wallet = ctx.accounts.guardian.key();
        checkpoint.telemetry_stream_id = telemetry_stream_id;
        checkpoint.masked_state_hash = masked_state_hash;
        checkpoint.timestamp = timestamp;
        checkpoint.is_active_shield = true;
        Ok(())
    }

    pub fn trigger_circuit_breaker(ctx: Context<TriggerCircuitBreaker>) -> Result<()> {
        let checkpoint = &mut ctx.accounts.proof_checkpoint;
        require!(checkpoint.is_active_shield, ErrorCode::ShieldAlreadyInactive);
        checkpoint.is_active_shield = false;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(telemetry_stream_id: [u8; 16])]
pub struct CommitBiometricProof<'info> {
    #[account(
        init,
        payer = guardian,
        space = 8 + 32 + 16 + 32 + 8 + 1,
        seeds = [b"biometric_proof", guardian.key().as_ref(), telemetry_stream_id.as_ref()],
        bump
    )]
    pub proof_checkpoint: Account<'info, ProofCheckpoint>,
    #[account(mut)]
    pub guardian: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TriggerCircuitBreaker<'info> {
    #[account(mut, has_one = guardian_wallet @ ErrorCode::UnauthorizedGuardian)]
    pub proof_checkpoint: Account<'info, ProofCheckpoint>,
    pub guardian_wallet: Signer<'info>,
}

#[account]
pub struct ProofCheckpoint {
    pub guardian_wallet: Pubkey,
    pub telemetry_stream_id: [u8; 16],
    pub masked_state_hash: [u8; 32],
    pub timestamp: i64,
    pub is_active_shield: bool,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Signer does not match the guardian wallet on this checkpoint.")]
    UnauthorizedGuardian,
    #[msg("Circuit breaker already triggered -- shield is inactive.")]
    ShieldAlreadyInactive,
}